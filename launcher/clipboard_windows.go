package main

import (
	"errors"
	"runtime"
	"syscall"
	"time"
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
	// Outro programa (ex.: o LibreOffice logo depois do Ctrl+C) pode estar com a área de
	// transferência aberta: tenta de novo por até meio segundo
	opened := false
	for i := 0; i < 25; i++ {
		if r, _, _ := procOpenClipboard.Call(0); r != 0 {
			opened = true
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	if !opened {
		return "", errors.New("área de transferência ocupada por outro programa")
	}
	defer procCloseClipboard.Call()
	if h, _, _ := procGetClipboardData.Call(13); h != 0 { // CF_UNICODETEXT
		if b := globalBytes(h); b != nil {
			u := make([]uint16, len(b)/2)
			for i := range u {
				u[i] = uint16(b[2*i]) | uint16(b[2*i+1])<<8
			}
			return syscall.UTF16ToString(u), nil
		}
	}
	if h, _, _ := procGetClipboardData.Call(1); h != 0 { // CF_TEXT (programas antigos)
		if b := globalBytes(h); b != nil {
			r := make([]rune, 0, len(b))
			for _, c := range b {
				if c == 0 {
					break
				}
				r = append(r, rune(c))
			}
			return string(r), nil
		}
	}
	return "", nil // sem texto
}

// Copia (no máximo 8 KB) o conteúdo de um bloco de memória global do Windows
func globalBytes(h uintptr) []byte {
	p, _, _ := procGlobalLock.Call(h)
	if p == 0 {
		return nil
	}
	defer procGlobalUnlock.Call(h)
	size, _, _ := procGlobalSize.Call(h)
	n := int(size)
	if n > 8192 {
		n = 8192 // só interessa texto curto
	}
	if n <= 0 {
		return []byte{}
	}
	buf := make([]byte, n)
	procMoveMemory.Call(uintptr(unsafe.Pointer(&buf[0])), p, uintptr(n))
	return buf
}
