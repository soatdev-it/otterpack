---
name: web-interface-review
description: Audit web UI code (components, pages, styles) against a published checklist of web interface rules covering accessibility, forms, focus, motion, performance and copy. Use when asked to review a UI, check accessibility, or audit a page or component against best practices.
---

# Web interface review

Review UI files against the Web Interface Guidelines maintained by Vercel Labs (MIT license): https://github.com/vercel-labs/web-interface-guidelines

## Steps

1. Get the current rules. Fetch `https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md` before each review, because the list changes. If you can't fetch it, say so and stop. Don't review from memory.
2. Settle the scope. Use the files or glob you were given. If you got none, ask which files to review. Don't sweep the whole repository.
3. Read each file and check it against every rule that applies to it. Skip rules that can't apply to the file, such as form rules on a component without inputs.
4. Report in the output format that the fetched rules ask for. Without one, write one line per finding: `path:line  rule  what to change`. Group the lines by file, and put a broken interaction or an accessibility failure first.
5. End with the number of findings per file, and the rules you couldn't check from the code alone (for example colour contrast set at runtime).

Don't edit files during the review. Fix them only when you're asked to.
