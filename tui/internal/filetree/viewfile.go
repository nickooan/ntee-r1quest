package filetree

import (
	"os"
	"path/filepath"
)

// OpenViewFile mirrors file-manager/types.ts OpenViewFile.
type OpenViewFile struct {
	FileName string
	Path     string
	Content  string
}

// ReadViewFile reads a file under root for viewing/editing, jailed to the root.
// Mirrors view-file.ts readViewFile (read errors surface as the file content, as
// in the TS version). ok is false when the path escapes the root or is empty.
func ReadViewFile(root, relativePath string) (OpenViewFile, bool) {
	if root == "" || relativePath == "" {
		return OpenViewFile{}, false
	}

	resolvedRoot, err := filepath.Abs(root)
	if err != nil {
		return OpenViewFile{}, false
	}
	resolvedPath := filepath.Join(resolvedRoot, relativePath)
	if !isInsideRoot(resolvedRoot, resolvedPath) {
		return OpenViewFile{}, false
	}

	name := filepath.Base(relativePath)
	data, err := os.ReadFile(resolvedPath)
	if err != nil {
		return OpenViewFile{FileName: name, Path: resolvedPath, Content: err.Error()}, true
	}
	return OpenViewFile{FileName: name, Path: resolvedPath, Content: string(data)}, true
}

// WriteViewFile writes content to an already-opened file path. Go is the sole
// writer of .nts/.ntd files (plan §3.1 invariant); the runtime never writes them.
func WriteViewFile(path, content string) error {
	return os.WriteFile(path, []byte(content), 0o644)
}
