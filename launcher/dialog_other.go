//go:build !windows

package main

import "errors"

var errCanceled = errors.New("cancelado")

const dialogSupported = false

func pickOpenFile(title string) (string, error) {
	return "", errors.New("janela Abrir disponível só no Windows")
}
