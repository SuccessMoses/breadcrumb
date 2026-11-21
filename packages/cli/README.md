# breadcrumb CLI

Runs Breadcrumb request templates and sequences from a terminal, without Caido.
The project is a JSON file, the same format the plugin's Backup tab exports.

```
breadcrumb project.json init
breadcrumb project.json add login.http
breadcrumb project.json tree-summary
breadcrumb project.json tree --limit 50 --json
breadcrumb project.json extend <parent-id> <template-id>
```

Every command takes `--json`, so an agent can read the output directly. Long
bodies are clipped by `show` unless `--full` is given.

Requests go straight to the Host in each template. Port 443 and ports not given
use TLS; other ports are plain unless `--tls` or `--plain` is given. Use
`--insecure` for a self-signed certificate.

Run `breadcrumb --help` for the full list of commands.
