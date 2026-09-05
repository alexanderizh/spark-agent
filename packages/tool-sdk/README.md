# @spark/tool-sdk

Typed helpers for `spark-tool-process-v1` Tool Package processes.

```ts
import { defineTool, serveTools } from '@spark/tool-sdk'
import { z } from 'zod'

serveTools({
  tools: {
    echo: defineTool({
      input: z.object({ text: z.string() }),
      run: async ({ text }, context) => {
        context.progress(0.5, 'Working')
        context.log('info', 'Echo is ready')
        return { text }
      },
    }),
  },
})
```

The SDK handles initialization, JSON Lines framing, input validation, cancellation, log/progress frames, structured errors, and host capability requests.

For Python, copy or import `python/spark_tool_sdk.py`. It has no third-party dependencies and provides the same log, progress, cancellation and host-capability primitives. A complete package is available under `examples/python-echo`.
