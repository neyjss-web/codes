//go:build !windows

package main

import "errors"

const clipboardSupported = false

func readClipboard() (string, error) {
	return "", errors.New("leitura da área de transferência disponível só no Windows")
}
