// YayNotes.exe — executável portátil para Windows (não requer instalação).
//
// Contém o aplicativo (YayNotes.html) embutido, serve-o apenas em 127.0.0.1 e o abre
// numa janela própria do Microsoft Edge (ou Chrome). Se um PDF for passado como argumento
// (arrastar o arquivo sobre o .exe, ou "Abrir com"), ele é carregado automaticamente.
// Executar o .exe de novo abre outra janela na instância já aberta (as janelas sincronizam os comentários).
package main

import (
	"crypto/rand"
	"crypto/sha256"
	_ "embed"
	"encoding/hex"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"
)

//go:embed YayNotes.html
var appHTML []byte

// Janelas abertas (id -> último sinal de vida). Quando a última fecha, o programa encerra em
// poucos segundos, liberando o YayNotes.exe (antes ele esperava até 3 minutos).
var (
	winMu      sync.Mutex
	windows    = map[string]time.Time{}
	closedWins = map[string]bool{} // janelas que já avisaram que fecharam (sinal atrasado não as reabre)
	lastChange = time.Now()
	graceUntil = time.Now().Add(90 * time.Second) // tempo para a janela abrir e dar o primeiro sinal
)

// YAYNOTES_DEBUG=1: mostra no terminal as janelas que abrem e fecham
var debugLog = os.Getenv("YAYNOTES_DEBUG") != ""

func windowAlive(id string) {
	if debugLog {
		fmt.Fprintln(os.Stderr, "ping", id)
	}
	winMu.Lock()
	defer winMu.Unlock()
	if id == "" {
		id = "?"
	}
	if closedWins[id] {
		return
	}
	if _, ok := windows[id]; !ok {
		lastChange = time.Now()
	}
	windows[id] = time.Now()
	graceUntil = time.Time{}
}

func windowClosed(id string) {
	if debugLog {
		fmt.Fprintln(os.Stderr, "bye", id)
	}
	winMu.Lock()
	defer winMu.Unlock()
	delete(windows, id)
	if id != "" {
		closedWins[id] = true
	}
	lastChange = time.Now()
}

// true quando não há janela aberta há alguns segundos (tempo para recarregar a página sem encerrar)
func shouldExit() bool {
	winMu.Lock()
	defer winMu.Unlock()
	now := time.Now()
	for id, t := range windows {
		// janela que parou de dar sinal (fechada sem aviso): o app avisa a cada 20 s, ou 1 min se minimizada
		if now.Sub(t) > 150*time.Second {
			delete(windows, id)
			lastChange = now
		}
	}
	return len(windows) == 0 && now.After(graceUntil) && now.Sub(lastChange) > 5*time.Second
}

// Arquivos abertos pelas janelas (cada janela recebe um número, passado no endereço como f=)
var (
	filesMu sync.Mutex
	files   = map[string]string{}
	nextID  int
)

func register(path string) string {
	if path == "" {
		return ""
	}
	filesMu.Lock()
	defer filesMu.Unlock()
	nextID++
	id := strconv.Itoa(nextID)
	files[id] = path
	return id
}

func fileFor(r *http.Request) string {
	filesMu.Lock()
	defer filesMu.Unlock()
	return files[r.URL.Query().Get("f")]
}

func argPath() string {
	if len(os.Args) > 1 {
		if p, err := filepath.Abs(os.Args[1]); err == nil {
			if st, err := os.Stat(p); err == nil && !st.IsDir() {
				return p
			}
		}
	}
	return ""
}

func main() {
	initialPath := argPath()
	// Uma só instância: se o YayNotes já estiver aberto, ele abre a nova janela. Assim todas as
	// janelas ficam no mesmo endereço e conseguem sincronizar os comentários entre si.
	if forwardToRunning(initialPath) {
		return
	}
	token := randomToken()

	ln, err := listenLocal()
	if err != nil {
		fail("Não foi possível iniciar o servidor local: " + err.Error())
	}
	addr := ln.Addr().String()
	windowURL := func(id string) string {
		u := fmt.Sprintf("http://%s/?t=%s", addr, token)
		if id != "" {
			u += "&f=" + id
		}
		return u
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
		path := fileFor(r)
		if r.URL.Query().Get("t") != token || path == "" {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		data, err := os.ReadFile(path)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/octet-stream")
		w.Header().Set("X-File-Name", url.PathEscape(filepath.Base(path)))
		w.Header().Set("X-Can-Save", "1")
		w.Write(data)
	})
	// Grava o PDF com os comentários de volta no arquivo recebido na linha de comando.
	// Grava primeiro num arquivo temporário na mesma pasta e só então substitui o original,
	// para que uma falha no meio do caminho nunca deixe o arquivo pela metade.
	mux.HandleFunc("/save-initial", func(w http.ResponseWriter, r *http.Request) {
		path := fileFor(r)
		if r.Method != http.MethodPost || r.URL.Query().Get("t") != token || path == "" {
			http.Error(w, "não permitido", http.StatusForbidden)
			return
		}
		tmp, err := os.CreateTemp(filepath.Dir(path), ".yaynotes-*.tmp")
		if err != nil {
			http.Error(w, "não foi possível criar o arquivo temporário: "+err.Error(), http.StatusInternalServerError)
			return
		}
		n, err := io.Copy(tmp, http.MaxBytesReader(w, r.Body, 4<<30))
		if cerr := tmp.Close(); err == nil {
			err = cerr
		}
		if err != nil || n < 5 {
			os.Remove(tmp.Name())
			http.Error(w, fmt.Sprintf("falha ao receber o arquivo: %v", err), http.StatusInternalServerError)
			return
		}
		if err := os.Rename(tmp.Name(), path); err != nil {
			os.Remove(tmp.Name())
			http.Error(w, "não foi possível substituir o arquivo (está aberto em outro programa?): "+err.Error(), http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})
	// Pedido de outra execução do YayNotes.exe: abre mais uma janela (com o PDF recebido, se houver)
	mux.HandleFunc("/open", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Query().Get("t") != token {
			http.Error(w, "não permitido", http.StatusForbidden)
			return
		}
		body, _ := io.ReadAll(io.LimitReader(r.Body, 32<<10))
		path := strings.TrimSpace(string(body))
		if path != "" {
			if st, err := os.Stat(path); err != nil || st.IsDir() {
				path = ""
			}
		}
		// "Nova janela" no app: mesmo arquivo da janela que pediu (f) e código para ela entregar o documento (w)
		id := r.URL.Query().Get("f")
		filesMu.Lock()
		_, known := files[id]
		filesMu.Unlock()
		if path != "" || !known {
			id = register(path)
		}
		u := windowURL(id)
		if wid := r.URL.Query().Get("w"); wid != "" && len(wid) <= 64 && strings.Trim(wid, "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789") == "" {
			u += "&w=" + wid
		}
		winMu.Lock()
		graceUntil = time.Now().Add(90 * time.Second) // a nova janela ainda vai abrir
		winMu.Unlock()
		openWindow(u)
		w.WriteHeader(http.StatusNoContent)
	})
	// "Abrir PDF" no app: janela Abrir do Windows. O arquivo escolhido fica registrado (X-File-Id)
	// e pode ser gravado depois por /save-initial, sem a confirmação do Edge.
	mux.HandleFunc("/pick-open", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Query().Get("t") != token {
			http.Error(w, "não permitido", http.StatusForbidden)
			return
		}
		if !dialogSupported {
			http.Error(w, "indisponível", http.StatusNotImplemented)
			return
		}
		path, err := pickOpenFile("Abrir PDF — YayNotes")
		if err == errCanceled {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if err != nil {
			http.Error(w, err.Error(), http.StatusNotImplemented)
			return
		}
		data, err := os.ReadFile(path)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/octet-stream")
		w.Header().Set("X-File-Name", url.PathEscape(filepath.Base(path)))
		w.Header().Set("X-File-Id", register(path))
		w.Write(data)
	})
	// Texto da área de transferência (caixa "Num." do app)
	mux.HandleFunc("/clipboard", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("t") != token {
			http.Error(w, "não permitido", http.StatusForbidden)
			return
		}
		if !clipboardSupported {
			http.Error(w, "indisponível", http.StatusNotImplemented)
			return
		}
		text, err := readClipboard()
		if err != nil {
			http.Error(w, err.Error(), http.StatusServiceUnavailable)
			return
		}
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		w.Header().Set("Cache-Control", "no-store")
		io.WriteString(w, text)
	})
	// Sinal de vida enviado pela página: o programa encerra quando a janela é fechada
	mux.HandleFunc("/ping", func(w http.ResponseWriter, r *http.Request) {
		windowAlive(r.URL.Query().Get("w"))
		w.WriteHeader(http.StatusNoContent)
	})
	// Aviso da página ao fechar a janela
	mux.HandleFunc("/bye", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("t") != token {
			http.Error(w, "não permitido", http.StatusForbidden)
			return
		}
		windowClosed(r.URL.Query().Get("w"))
		w.WriteHeader(http.StatusNoContent)
	})
	go http.Serve(ln, mux)

	writeInstance(addr, token)
	defer removeInstance(token)

	appURL := windowURL(register(initialPath))
	fmt.Println(appURL)

	openWindow(appURL)
	// Mantém o servidor enquanto houver janela aberta; encerra logo depois que a última fecha
	for !shouldExit() {
		time.Sleep(time.Second)
	}
}

func openWindow(u string) {
	if cmd := startAppWindow(u); cmd != nil {
		go cmd.Wait()
	} else {
		openDefaultBrowser(u)
	}
}

// Endereço fixo (o primeiro livre de uma pequena faixa): assim o Edge lembra, de uma vez para outra,
// as permissões dadas ao app (área de transferência) e as preferências (nome do autor, tamanhos).
func listenLocal() (net.Listener, error) {
	for port := 47391; port < 47401; port++ {
		if ln, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", port)); err == nil {
			return ln, nil
		}
	}
	return net.Listen("tcp", "127.0.0.1:0")
}

// Arquivo com o endereço da instância em execução (só o usuário do Windows tem acesso à pasta)
func instanceFile() string {
	base := os.Getenv("LOCALAPPDATA")
	if base == "" {
		base = os.TempDir()
	}
	return filepath.Join(base, "YayNotes", "instancia.txt")
}

// Versão do app embutido: uma instância só recebe janelas de um .exe com o mesmo app.
// Assim, ao trocar o YayNotes.exe por uma versão nova, a nova janela nunca abre a versão antiga.
func appVersion() string {
	h := sha256.Sum256(appHTML)
	return hex.EncodeToString(h[:6])
}

func writeInstance(addr, token string) {
	f := instanceFile()
	os.MkdirAll(filepath.Dir(f), 0o755)
	os.WriteFile(f, []byte(addr+" "+token+" "+appVersion()), 0o600)
}

func removeInstance(token string) {
	f := instanceFile()
	if b, err := os.ReadFile(f); err == nil {
		if parts := strings.Fields(string(b)); len(parts) >= 2 && parts[1] == token {
			os.Remove(f)
		}
	}
}

// Pede à instância já aberta que abra uma nova janela. Devolve false se não houver instância ativa.
func forwardToRunning(path string) bool {
	b, err := os.ReadFile(instanceFile())
	if err != nil {
		return false
	}
	parts := strings.Fields(string(b))
	if len(parts) != 3 || parts[2] != appVersion() {
		return false // instância de outra versão: esta passa a ser a principal
	}
	client := http.Client{Timeout: 5 * time.Second}
	resp, err := client.Post("http://"+parts[0]+"/open?t="+url.QueryEscape(parts[1]), "text/plain; charset=utf-8", strings.NewReader(path))
	if err != nil {
		return false
	}
	resp.Body.Close()
	return resp.StatusCode == http.StatusNoContent
}

func startAppWindow(appURL string) *exec.Cmd {
	profile := filepath.Join(os.Getenv("LOCALAPPDATA"), "YayNotes", "perfil")
	if os.Getenv("LOCALAPPDATA") == "" {
		profile = filepath.Join(os.TempDir(), "YayNotes-perfil")
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
			"--start-maximized",
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
