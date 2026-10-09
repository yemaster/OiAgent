#!/usr/bin/env node
// Offline fixture for validating plugins and task output. No LLM is called.
const prompt = process.argv[2] || 'Hello from OI Agent'
const emit = event => process.stdout.write(JSON.stringify(event) + '\n')
emit({ type: 'item.completed', item: { type: 'agent_message', text: `收到测试任务：${prompt}\n\n这是离线插件示例，不会调用模型或修改项目。` } })
await new Promise(resolve => setTimeout(resolve, 1200))
emit({ type: 'item.completed', item: { type: 'agent_message', text: '插件执行完成。标准输出、任务状态和历史保存可正常工作。' } })
