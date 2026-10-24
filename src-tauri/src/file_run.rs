//! Single-file runners. Paths are quoted as literal shell arguments; compilation
//! uses an isolated output directory and never executes a stale project binary.
use std::path::{Path, PathBuf};

#[derive(Debug)]
pub(crate) struct Plan {
    pub shell: String,
    pub args: Vec<String>,
    pub label: String,
    pub directory: tempfile::TempDir,
}
fn quote(value: &str, windows: bool) -> String {
    if windows {
        format!("'{}'", value.replace('\'', "''"))
    } else {
        format!("'{}'", value.replace('\'', "'\\''"))
    }
}
fn command(program: &Path, args: &[String], windows: bool) -> String {
    let mut parts = vec![quote(&program.to_string_lossy(), windows)];
    parts.extend(args.iter().map(|value| quote(value, windows)));
    format!("{}{}", if windows { "& " } else { "" }, parts.join(" "))
}
fn find(names: &[&str]) -> Result<PathBuf, String> {
    names
        .iter()
        .find_map(|name| crate::discovery::resolve(name))
        .ok_or_else(|| format!("未找到 {}，请安装后重试", names.join(" / ")))
}
pub(crate) fn prepare(project: &str, path: &str) -> Result<Plan, String> {
    let file = crate::files::checked_path(project, path)?;
    if !file.is_file() {
        return Err("请选择代码文件".into());
    }
    let windows = cfg!(windows);
    let ext = file
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    let directory = tempfile::Builder::new()
        .prefix("oiagent-run-")
        .tempdir()
        .map_err(|e| e.to_string())?;
    let output = directory
        .path()
        .join(if windows { "program.exe" } else { "program" });
    let source = file.to_string_lossy().into_owned();
    let binary = output.to_string_lossy().into_owned();
    let (program, args, compiled) = match ext.as_str() {
        "c" | "cc" | "cpp" | "cxx" => {
            let cpp = ext != "c";
            let compiler = find(if cpp {
                if windows {
                    &["clang++", "g++", "cl"]
                } else {
                    &["clang++", "g++"]
                }
            } else if windows {
                &["clang", "gcc", "cl"]
            } else {
                &["clang", "gcc"]
            })?;
            let msvc = compiler
                .file_stem()
                .is_some_and(|name| name.to_string_lossy().eq_ignore_ascii_case("cl"));
            let args = if msvc {
                vec![
                    "/nologo".into(),
                    if cpp { "/std:c++17" } else { "/std:c11" }.into(),
                    "/EHsc".into(),
                    source,
                    format!("/Fe:{binary}"),
                    format!("/Fo:{}", directory.path().join("program.obj").display()),
                    format!("/Fd:{}", directory.path().join("program.pdb").display()),
                ]
            } else {
                vec![
                    if cpp { "-std=c++17" } else { "-std=c11" }.into(),
                    source,
                    "-o".into(),
                    binary,
                ]
            };
            (compiler, args, true)
        }
        "rs" => (
            find(&["rustc"])?,
            vec!["--edition=2021".into(), source, "-o".into(), binary],
            true,
        ),
        "py" => {
            let interpreter = [".venv", "venv"]
                .iter()
                .map(|dir| {
                    Path::new(project).join(dir).join(if windows {
                        "Scripts/python.exe"
                    } else {
                        "bin/python"
                    })
                })
                .find(|candidate| candidate.is_file())
                .map(Ok)
                .unwrap_or_else(|| {
                    find(if windows {
                        &["python", "py", "python3"]
                    } else {
                        &["python3", "python"]
                    })
                })?;
            (interpreter, vec!["-u".into(), source], false)
        }
        "js" | "mjs" | "cjs" => (find(&["node"])?, vec![source], false),
        "go" => (find(&["go"])?, vec!["run".into(), source], false),
        _ => return Err("暂不支持直接运行此类文件".into()),
    };
    let build = command(&program, &args, windows);
    let script = execution_script(
        &build,
        compiled.then(|| command(&output, &[], windows)).as_deref(),
        windows,
    );
    let (shell, args) = if windows {
        (
            find(&["pwsh", "powershell"])?
                .to_string_lossy()
                .into_owned(),
            vec![
                "-NoLogo".into(),
                "-NoExit".into(),
                "-Command".into(),
                script,
            ],
        )
    } else {
        let shell = std::env::var("SHELL")
            .ok()
            .filter(|value| Path::new(value).is_absolute() && Path::new(value).is_file())
            .unwrap_or_else(|| "/bin/sh".into());
        (
            "/bin/sh".into(),
            vec![
                "-c".into(),
                format!("{script}\nexec {} -i", quote(&shell, false)),
            ],
        )
    };
    Ok(Plan {
        shell,
        args,
        label: format!(
            "运行 {}",
            file.file_name().unwrap_or_default().to_string_lossy()
        ),
        directory,
    })
}
fn execution_script(build: &str, executable: Option<&str>, windows: bool) -> String {
    if windows {
        format!("$global:LASTEXITCODE = 1; Write-Host {}; {build}; {}Write-Host ('退出码: ' + $LASTEXITCODE)", quote(build, true), executable.map(|exe| format!("if ($? -and $LASTEXITCODE -eq 0) {{ {exe} }}; ")).unwrap_or_default())
    } else {
        format!(
            "printf '%s\\n' {}\n{build}{}\nstatus=$?\nprintf '\\n退出码: %s\\n' \"$status\"",
            quote(build, false),
            executable
                .map(|exe| format!(" && {exe}"))
                .unwrap_or_default()
        )
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn quotes_paths_and_gates_execution_on_success_on_both_platforms() {
        let path = "C:\\work space\\it's $(echo bad) & %PATH%.cpp";
        assert_eq!(
            quote(path, true),
            "'C:\\work space\\it''s $(echo bad) & %PATH%.cpp'"
        );
        assert_eq!(quote("a'b $HOME", false), "'a'\\''b $HOME'");
        assert!(execution_script("compile", Some("run"), true)
            .contains("if ($? -and $LASTEXITCODE -eq 0) { run }"));
        assert!(execution_script("compile", Some("run"), false).contains("\ncompile && run\n"));
    }
    #[test]
    #[cfg(unix)]
    fn runs_literal_python_paths_and_does_not_run_after_compilation_failure() {
        if find(&["python3", "python"]).is_err() {
            return;
        }
        let dir = tempfile::tempdir().unwrap();
        let name = "hello ' $(touch injected).py";
        std::fs::write(dir.path().join(name), "print('runner-ok')").unwrap();
        let plan = prepare(dir.path().to_str().unwrap(), name).unwrap();
        let script = plan.args[1].rsplit_once("\nexec ").unwrap().0;
        let output = std::process::Command::new(&plan.shell)
            .args(["-c", script])
            .current_dir(dir.path())
            .output()
            .unwrap();
        assert!(String::from_utf8_lossy(&output.stdout).contains("runner-ok"));
        assert!(!dir.path().join("injected").exists());
        let marker = dir.path().join("should-not-run");
        let script = execution_script(
            "false",
            Some(&format!(
                "touch {}",
                quote(&marker.to_string_lossy(), false)
            )),
            false,
        );
        let output = std::process::Command::new("/bin/sh")
            .args(["-c", &script])
            .output()
            .unwrap();
        assert!(!marker.exists());
        assert!(String::from_utf8_lossy(&output.stdout).contains("退出码: 1"));
    }

    #[test]
    #[cfg(unix)]
    fn compiles_a_cpp_file_into_an_isolated_directory() {
        if find(&["clang++", "g++"]).is_err() {
            return;
        }
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(
            dir.path().join("hello world.cpp"),
            "#include <cstdio>\nint main() { puts(\"cpp-runner-ok\"); }",
        )
        .unwrap();
        let plan = prepare(dir.path().to_str().unwrap(), "hello world.cpp").unwrap();
        let script = plan.args[1].rsplit_once("\nexec ").unwrap().0;
        let output = std::process::Command::new(&plan.shell)
            .args(["-c", script])
            .current_dir(dir.path())
            .output()
            .unwrap();
        assert!(
            String::from_utf8_lossy(&output.stdout).contains("cpp-runner-ok"),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        assert!(plan.directory.path().join("program").is_file());
        assert!(!dir.path().join("a.out").exists());
        let temporary = plan.directory.path().to_owned();
        drop(plan);
        assert!(!temporary.exists());
    }

    #[test]
    #[cfg(windows)]
    fn powershell_keeps_paths_literal() {
        let shell = find(&["pwsh", "powershell"]).expect("Windows PowerShell");
        let literal = "C:\\work space\\it's $(throw 'bad') & %PATH%.cpp";
        let output = crate::process::command(shell)
            .args([
                "-NoLogo",
                "-NoProfile",
                "-Command",
                &format!("Write-Output {}", quote(literal, true)),
            ])
            .output()
            .unwrap();
        assert!(output.status.success());
        assert_eq!(String::from_utf8_lossy(&output.stdout).trim(), literal);
    }

    #[test]
    fn refuses_unsupported_and_outside_files() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("readme.md"), "# hi").unwrap();
        assert!(prepare(dir.path().to_str().unwrap(), "readme.md")
            .unwrap_err()
            .contains("暂不支持"));
        assert!(prepare(dir.path().to_str().unwrap(), "../outside.py").is_err());
    }
}
