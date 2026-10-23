//! In-app terminal sessions backed by a pseudo-terminal. Output is streamed
//! to the UI as `term-data` events; input and resizes come back as commands.

use crate::shell_prompt;
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter};

struct Session {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn Child + Send + Sync>,
}

#[derive(Default)]
pub struct Terminals(Mutex<HashMap<u32, Session>>);

#[derive(Serialize, Clone)]
struct Data {
    id: u32,
    data: String,
}

#[derive(Serialize, Clone)]
pub struct Shell {
    pub id: &'static str,
    pub name: &'static str,
    pub program: String,
}

pub fn shells() -> Vec<Shell> {
    let mut out = Vec::new();
    if cfg!(windows) {
        let pf = std::env::var("ProgramFiles").unwrap_or_else(|_| "C:/Program Files".into());
        let pwsh7 = format!("{pf}/PowerShell/7/pwsh.exe");
        if std::path::Path::new(&pwsh7).exists() {
            out.push(Shell { id: "pwsh", name: "PowerShell 7", program: pwsh7 });
        }
        out.push(Shell { id: "powershell", name: "Windows PowerShell", program: "powershell.exe".into() });
        out.push(Shell { id: "cmd", name: "Command Prompt", program: "cmd.exe".into() });
        let bash = format!("{pf}/Git/bin/bash.exe");
        if std::path::Path::new(&bash).exists() {
            out.push(Shell { id: "gitbash", name: "Git Bash", program: bash });
        }
        let wsl = std::env::var("SystemRoot").map(|r| format!("{r}/System32/wsl.exe")).unwrap_or_default();
        if std::path::Path::new(&wsl).exists() {
            out.push(Shell { id: "wsl", name: "WSL", program: wsl });
        }
    } else {
        let sh = std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".into());
        out.push(Shell { id: "default", name: "Default shell", program: sh });
    }
    out
}

pub fn spawn(app: AppHandle, state: &Terminals, id: u32, cwd: &str, shell: &str, cols: u16, rows: u16) -> Result<(), String> {
    let program = shells()
        .into_iter()
        .find(|s| s.id == shell)
        .or_else(|| shells().into_iter().next())
        .map(|s| s.program)
        .ok_or("no shell available")?;
    let pty = native_pty_system();
    let pair = pty
        .openpty(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
        .map_err(|e| e.to_string())?;
    let mut cmd = CommandBuilder::new(&program);
    if shell == "gitbash" {
        cmd.arg("--login");
        cmd.arg("-i");
    }
    cmd.cwd(cwd);
    cmd.env("TERM", "xterm-256color");
    // The branch in the prompt is cosmetic: without its scripts the
    // terminal still opens, with the shell's usual prompt.
    if let Ok(dir) = shell_prompt::dir(&app) {
        if shell_prompt::install(&dir).is_ok() {
            shell_prompt::configure(&mut cmd, shell, &program, &dir, &shell_prompt::head_file(&dir, cwd));
        }
    }
    let child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    drop(pair.slave);
    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;
    std::thread::spawn(move || {
        let mut buf = [0u8; 8192];
        let mut pending: Vec<u8> = Vec::new();
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    pending.extend_from_slice(&buf[..n]);
                    // Only emit complete UTF-8; keep a split multibyte tail.
                    let valid = match std::str::from_utf8(&pending) {
                        Ok(_) => pending.len(),
                        Err(e) if e.error_len().is_none() => e.valid_up_to(),
                        Err(_) => pending.len(),
                    };
                    let data = String::from_utf8_lossy(&pending[..valid]).into_owned();
                    pending.drain(..valid);
                    let _ = app.emit("term-data", Data { id, data });
                }
            }
        }
        let _ = app.emit("term-exit", id);
    });
    state.0.lock().unwrap().insert(id, Session { master: pair.master, writer, child });
    Ok(())
}

pub fn write(state: &Terminals, id: u32, data: &str) -> Result<(), String> {
    let mut map = state.0.lock().unwrap();
    let s = map.get_mut(&id).ok_or("no such terminal")?;
    s.writer.write_all(data.as_bytes()).map_err(|e| e.to_string())?;
    s.writer.flush().map_err(|e| e.to_string())
}

pub fn resize(state: &Terminals, id: u32, cols: u16, rows: u16) -> Result<(), String> {
    let map = state.0.lock().unwrap();
    let s = map.get(&id).ok_or("no such terminal")?;
    s.master
        .resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
        .map_err(|e| e.to_string())
}

pub fn kill(state: &Terminals, id: u32) {
    if let Some(mut s) = state.0.lock().unwrap().remove(&id) {
        let _ = s.child.kill();
    }
}
