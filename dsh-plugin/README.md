# DSH Task Map Plugin

This directory is the DeepSeek Harness plugin package for the AI Coding Task Map.

## Install

The preferred one-click source is the repository root in the DSH plugin manager:

<https://github.com/httpwzh/ai-coding-task-map>

This directory is also installable directly. Use the DSH plugin manager and install this directory as a local plugin:

```text
<task-map-project>\dsh-plugin
```

If the DSH version supports GitHub subdirectories, use:

<https://github.com/httpwzh/ai-coding-task-map/tree/main/dsh-plugin>

Do not install the repository root. The repository root is the task-map web application, not the DSH plugin package.

The task-map web service must also be running at:

```text
http://127.0.0.1:4173
```

The plugin is read-only with respect to DSH sessions. It opens the local task-map page and transfers bounded session snapshots to it.
