package runtime

import (
	"bufio"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"time"
)

// Supervisor spawns and owns the lifecycle of the TS runtime server process. The
// Go TUI is the parent: it starts the runtime, waits for it to be ready, and
// kills it on exit (plan §5, Phase D5).
type Supervisor struct {
	cmd        *exec.Cmd
	SocketPath string
}

// StartOptions configures a runtime spawn.
type StartOptions struct {
	NodeBin      string // node binary (default "node")
	ServerScript string // path to dist/src/runtime-server.js
	Root         string // request root (-r)
	AI           string // ai adaptor (-ai), optional
	ReadyTimeout time.Duration
}

// Start launches the runtime server on a fresh socket and blocks until it prints
// "ready" (or the timeout elapses). The caller must call Stop.
func Start(opts StartOptions) (*Supervisor, error) {
	if opts.NodeBin == "" {
		opts.NodeBin = "node"
	}
	if opts.ReadyTimeout == 0 {
		opts.ReadyTimeout = 15 * time.Second
	}

	socketPath := filepath.Join(
		os.TempDir(),
		fmt.Sprintf("r1q-%d-%d.sock", os.Getpid(), time.Now().UnixNano()),
	)

	args := []string{opts.ServerScript, "--socket", socketPath, "-r", opts.Root}
	if opts.AI != "" {
		args = append(args, "-ai", opts.AI)
	}

	cmd := exec.Command(opts.NodeBin, args...)
	cmd.Stderr = os.Stderr

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, err
	}
	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("starting runtime: %w", err)
	}

	ready := make(chan error, 1)
	go func() {
		scanner := bufio.NewScanner(stdout)
		for scanner.Scan() {
			if strings.TrimSpace(scanner.Text()) == "ready" {
				ready <- nil
				return
			}
		}
		ready <- fmt.Errorf("runtime exited before signaling ready")
	}()

	select {
	case err := <-ready:
		if err != nil {
			_ = cmd.Process.Kill()
			return nil, err
		}
	case <-time.After(opts.ReadyTimeout):
		_ = cmd.Process.Kill()
		return nil, fmt.Errorf("runtime did not become ready within %s", opts.ReadyTimeout)
	}

	return &Supervisor{cmd: cmd, SocketPath: socketPath}, nil
}

// Stop terminates the runtime process and removes the socket file.
func (s *Supervisor) Stop() {
	if s.cmd != nil && s.cmd.Process != nil {
		_ = s.cmd.Process.Signal(syscall.SIGTERM)
		done := make(chan struct{})
		go func() {
			_, _ = s.cmd.Process.Wait()
			close(done)
		}()
		select {
		case <-done:
		case <-time.After(3 * time.Second):
			_ = s.cmd.Process.Kill()
		}
	}
	_ = os.Remove(s.SocketPath)
}
