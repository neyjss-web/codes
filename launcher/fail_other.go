//go:build !windows

package main

import (
	"fmt"
	"os"
)

func fail(msg string) {
	fmt.Fprintln(os.Stderr, msg)
	os.Exit(1)
}
