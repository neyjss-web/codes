package main

import (
	"errors"
	"runtime"
	"syscall"
	"unicode/utf16"
	"unsafe"
)

// Janela "Abrir" do Windows, mostrada pelo próprio YayNotes.exe. O arquivo escolhido assim é
// gravado depois pelo programa, sem a confirmação "Salvar alterações?" que o Edge exige para
// arquivos abertos pela página.

type openFileName struct {
	lStructSize       uint32
	hwndOwner         uintptr
	hInstance         uintptr
	lpstrFilter       *uint16
	lpstrCustomFilter *uint16
	nMaxCustFilter    uint32
	nFilterIndex      uint32
	lpstrFile         *uint16
	nMaxFile          uint32
	lpstrFileTitle    *uint16
	nMaxFileTitle     uint32
	lpstrInitialDir   *uint16
	lpstrTitle        *uint16
	flags             uint32
	nFileOffset       uint16
	nFileExtension    uint16
	lpstrDefExt       *uint16
	lCustData         uintptr
	lpfnHook          uintptr
	lpTemplateName    *uint16
	pvReserved        uintptr
	dwReserved        uint32
	flagsEx           uint32
}

var (
	comdlg32              = syscall.NewLazyDLL("comdlg32.dll")
	procGetOpenFileName   = comdlg32.NewProc("GetOpenFileNameW")
	procCommDlgExtError   = comdlg32.NewProc("CommDlgExtendedError")
	user32dlg             = syscall.NewLazyDLL("user32.dll")
	procGetForegroundWnd  = user32dlg.NewProc("GetForegroundWindow")
	procGetWindowThreadID = user32dlg.NewProc("GetWindowThreadProcessId")
	procAttachThreadInput = user32dlg.NewProc("AttachThreadInput")
	kernel32dlg           = syscall.NewLazyDLL("kernel32.dll")
	procGetCurrentThread  = kernel32dlg.NewProc("GetCurrentThreadId")
)

var errCanceled = errors.New("cancelado")

const dialogSupported = true

// utf16z converte texto com separadores \x00 (lista de filtros) para UTF-16 terminado em zero
func utf16z(s string) *uint16 {
	u := utf16.Encode([]rune(s + "\x00"))
	return &u[0]
}

func pickOpenFile(title string) (string, error) {
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()
	// A janela do app (Edge) está em primeiro plano: a caixa de diálogo fica presa a ela e na frente dela
	owner, _, _ := procGetForegroundWnd.Call()
	if owner != 0 {
		fgThread, _, _ := procGetWindowThreadID.Call(owner, 0)
		cur, _, _ := procGetCurrentThread.Call()
		if fgThread != 0 && fgThread != cur {
			procAttachThreadInput.Call(cur, fgThread, 1)
			defer procAttachThreadInput.Call(cur, fgThread, 0)
		}
	}
	buf := make([]uint16, 32768)
	ofn := openFileName{
		hwndOwner:    owner,
		lpstrFilter:  utf16z("Arquivos PDF (*.pdf)\x00*.pdf\x00Todos os arquivos (*.*)\x00*.*\x00"),
		nFilterIndex: 1,
		lpstrFile:    &buf[0],
		nMaxFile:     uint32(len(buf)),
		lpstrTitle:   utf16z(title),
		// OFN_EXPLORER | OFN_FILEMUSTEXIST | OFN_PATHMUSTEXIST | OFN_HIDEREADONLY | OFN_NOCHANGEDIR
		flags: 0x80000 | 0x1000 | 0x800 | 0x4 | 0x8,
	}
	ofn.lStructSize = uint32(unsafe.Sizeof(ofn))
	r, _, _ := procGetOpenFileName.Call(uintptr(unsafe.Pointer(&ofn)))
	if r == 0 {
		if code, _, _ := procCommDlgExtError.Call(); code != 0 {
			return "", errors.New("falha na janela Abrir do Windows")
		}
		return "", errCanceled
	}
	return syscall.UTF16ToString(buf), nil
}
