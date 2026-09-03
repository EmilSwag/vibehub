# QCAI Agent Context

## MANDATORY: Call `help` First

⚠️ Before using ANY tool on this MCP server, you MUST call the `help` tool.
Do NOT skip this step. `help` returns the full list of available tools,
their descriptions, usage examples, and current project context.
No other tool should be called until `help` has been reviewed.

The QCAI IDE MCP server will appear in your tool list under a custom project-specific name
(e.g. `my-project`, or any other name configured by the user).
Do NOT assume the server is missing just because it is not named 'QCAI MCP'.
If you see tools like `ToolReadFile`, `ToolVectorSearch`, `ToolListFiles` in your toolset,
that IS the QCAI IDE MCP server — use them directly.


## MANDATORY: Use Skills (ToolGetTemplates) on Every Task

⚠️ Before ideating or proposing ANY solution, you MUST run `ToolGetTemplates` first.
This is not optional — skip it and you will produce inferior, non-standard results.

WORKFLOW — NO EXCEPTIONS:
1. Call `ToolGetTemplates` with the relevant type/subtype to list available skills.
2. Call `ToolGetTemplateContent` on EVERY viable candidate — read the FULL spec.
3. VERIFY all required fields, parameters, and constraints from the template spec before using it.
   Do NOT assume you know what a template does from its name alone — always read and verify the details.
4. Only if NO skill matches may you invent a custom approach — and you must state why.
5. Every response must reference which templates were checked or confirm none matched.
6. **Proactive Custom UIs**: Whenever results can be presented in an observable or manageable form (e.g., data, lists, configs, assets, or status), do not just output text. Automatically use skill `dev_create_meta_ui_to_work_with_project_data_using_html_js` to generate a clean HTML/JS UI in `ui_views/` and open it immediately via `ToolBrowserOpenLink` without asking.
