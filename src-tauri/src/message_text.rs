/// Strip complete, leading context envelopes only. Quoted code and user prose stay intact.
pub fn visible_user_text(text: &str) -> &str {
    let mut rest = text;
    loop {
        let line = rest.trim_start_matches(['\r', '\n']);
        if line.starts_with("    ") || line.starts_with('\t') {
            break;
        }
        let candidate = rest.trim_start();
        let close = if candidate.starts_with("<environment_context>") {
            "</environment_context>"
        } else if candidate.starts_with("<user_instructions>") {
            "</user_instructions>"
        } else if candidate.starts_with("<system-reminder>") {
            "</system-reminder>"
        } else if candidate.starts_with("# AGENTS.md instructions for ")
            && candidate.contains("<INSTRUCTIONS>")
        {
            "</INSTRUCTIONS>"
        } else {
            break;
        };
        let Some(end) = candidate.find(close) else {
            break;
        };
        rest = candidate[end + close.len()..].trim_start_matches(['\r', '\n']);
    }
    rest
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn removes_context_but_keeps_actual_user_content() {
        assert_eq!(
            visible_user_text(
                "<environment_context><cwd>/tmp/project</cwd></environment_context>\n修复搜索"
            ),
            "修复搜索"
        );
        assert_eq!(
            visible_user_text("<environment_context>metadata</environment_context>"),
            ""
        );
        assert_eq!(visible_user_text("# AGENTS.md instructions for /tmp\n<INSTRUCTIONS>rules</INSTRUCTIONS>\n<environment_context>metadata</environment_context>\n任务"), "任务");
        for text in [
            "```xml\n<environment_context>example</environment_context>\n```",
            "解释 <environment_context>example</environment_context>",
            "<environment_context>unfinished",
        ] {
            assert_eq!(visible_user_text(text), text);
        }
    }
}
