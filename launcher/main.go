// PDFNotas.exe — executável portátil para Windows (não requer instalação).
//
// Contém o aplicativo (PDFNotas.html) embutido, serve-o apenas em 127.0.0.1 e o abre
// numa janela própria do Microsoft Edge (ou Chrome). Se um PDF for passado como argumento
// (arrastar o arquivo sobre o .exe, ou "Abrir com"), ele é carregado automaticamente.
package main

import (
	"crypto/rand"
	_ "embed"
	"encoding/hex"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sync/atomic"
	"time"
)

//go:embed PDFNotas.html
var appHTML []byte

var lastPing atomic.Int64

func main() {
	token := randomToken()
	var initialPath string
	if len(os.Args) > 1 {
		if p, err := filepath.Abs(os.Args[1]); err == nil {
			if st, err := os.Stat(p); err == nil && !st.IsDir() {
				initialPath = p
			}
		}
	}

	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		fail("Não foi possível iniciar o servidor local: " + err.Error())
	}
	mux := http.NewServeMux()
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Header().Set("Cache-Control", "no-store")
		w.Write(appHTML)
	})
	// Arquivo passado na linha de comando
	mux.HandleFunc("/initial", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("t") != token || initialPath == "" {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		data, err := os.ReadFile(initialPath)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/octet-stream")
		w.Header().Set("X-File-Name", url.PathEscape(filepath.Base(initialPath)))
		w.Write(data)
	})
	// Sinal de vida enviado pela página: o programa encerra quando a janela é fechada
	mux.HandleFunc("/ping", func(w http.ResponseWriter, r *http.Request) {
		lastPing.Store(time.Now().Unix())
		w.WriteHeader(http.StatusNoContent)
	})
	go http.Serve(ln, mux)

	appURL := fmt.Sprintf("http://%s/?t=%s", ln.Addr().String(), token)
	fmt.Println(appURL)
	lastPing.Store(time.Now().Unix())

	if cmd := startAppWindow(appURL); cmd != nil {
		// Janela dedicada (perfil próprio): encerra quando ela for fechada
		cmd.Wait()
		// Se o navegador repassou a janela para uma instância já aberta, continua pelos pings
		if time.Since(time.Unix(lastPing.Load(), 0)) > 30*time.Second {
			return
		}
	} else {
		openDefaultBrowser(appURL)
	}
	// Mantém o servidor enquanto a página enviar sinais de vida
	for {
		time.Sleep(15 * time.Second)
		if time.Since(time.Unix(lastPing.Load(), 0)) > 3*time.Minute {
			return
		}
	}
}

func startAppWindow(appURL string) *exec.Cmd {
	profile := filepath.Join(os.Getenv("LOCALAPPDATA"), "PDFNotas", "perfil")
	if os.Getenv("LOCALAPPDATA") == "" {
		profile = filepath.Join(os.TempDir(), "PDFNotas-perfil")
	}
	os.MkdirAll(profile, 0o755)
	for _, exe := range browserCandidates() {
		if _, err := os.Stat(exe); err != nil {
			continue
		}
		cmd := exec.Command(exe,
			"--app="+appURL,
			"--user-data-dir="+profile,
			"--no-first-run",
			"--no-default-browser-check",
			"--window-size=1400,900",
		)
		if err := cmd.Start(); err == nil {
			return cmd
		}
	}
	return nil
}

func browserCandidates() []string {
	var out []string
	for _, base := range []string{os.Getenv("ProgramFiles(x86)"), os.Getenv("ProgramFiles"), os.Getenv("LOCALAPPDATA")} {
		if base == "" {
			continue
		}
		out = append(out,
			filepath.Join(base, "Microsoft", "Edge", "Application", "msedge.exe"),
			filepath.Join(base, "Google", "Chrome", "Application", "chrome.exe"),
		)
	}
	if runtime.GOOS != "windows" {
		out = append(out, "/usr/bin/chromium", "/usr/bin/google-chrome", "/usr/bin/microsoft-edge")
	}
	return out
}

func openDefaultBrowser(u string) {
	switch runtime.GOOS {
	case "windows":
		exec.Command("rundll32", "url.dll,FileProtocolHandler", u).Start()
	case "darwin":
		exec.Command("open", u).Start()
	default:
		exec.Command("xdg-open", u).Start()
	}
}

func randomToken() string {
	b := make([]byte, 16)
	rand.Read(b)
	return hex.EncodeToString(b)
}
