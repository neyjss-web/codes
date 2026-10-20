package main

import (
	"errors"
	"runtime"
	"syscall"
	"unsafe"
)

// Lê o texto da área de transferência do Windows (para a caixa "Num." do app), sem depender
// da permissão do Edge para a página ler a área de transferência.

var (
	user32clip           = syscall.NewLazyDLL("user32.dll")
	procOpenClipboard    = user32clip.NewProc("OpenClipboard")
	procCloseClipboard   = user32clip.NewProc("CloseClipboard")
	procGetClipboardData = user32clip.NewProc("GetClipboardData")
	kernel32clip         = syscall.NewLazyDLL("kernel32.dll")
	procGlobalLock       = kernel32clip.NewProc("GlobalLock")
	procGlobalUnlock     = kernel32clip.NewProc("GlobalUnlock")
	procGlobalSize       = kernel32clip.NewProc("GlobalSize")
	procMoveMemory       = kernel32clip.NewProc("RtlMoveMemory")
)

const clipboardSupported = true

func readClipboard() (string, error) {
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()
	if r, _, _ := procOpenClipboard.Call(0); r == 0 {
		return "", errors.New("área de transferência ocupada")
	}
	defer procCloseClipboard.Call()
	h, _, _ := procGetClipboardData.Call(13) // CF_UNICODETEXT
	if h == 0 {
		return "", nil // sem texto
	}
	p, _, _ := procGlobalLock.Call(h)
	if p == 0 {
		return "", errors.New("não foi possível ler a área de transferência")
	}
	defer procGlobalUnlock.Call(h)
	size, _, _ := procGlobalSize.Call(h)
	n := int(size / 2)
	if n > 4096 {
		n = 4096 // só interessa texto curto
	}
	if n == 0 {
		return "", nil
	}
	buf := make([]uint16, n)
	procMoveMemory.Call(uintptr(unsafe.Pointer(&buf[0])), p, uintptr(n*2))
	return syscall.UTF16ToString(buf), nil
}
