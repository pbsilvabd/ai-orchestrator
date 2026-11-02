# AI Orchestrator

Scaffold incremental de orquestração sobre OpenCode. Licença MIT.

## Estado desta entrega

Implementado: política pura de fallback, demo com dois provedores simulados e testes
locais sem dependências. **Não é um plugin instalado nem um MVP integrado ao OpenCode.**
Nenhuma chamada de IA, chave, conta de provedor ou API paga é necessária.

Referência avaliada: OpenCode **2.2.5**, commit
`9bbb8ce18c80f099e0e448775f59d965ead40a21`. Os plugins candidatos permanecem
desativados até passarem pelos critérios da [auditoria](docs/plugin-audit.md).

## Executar

Use Node.js 24 (validado com 24.22.1), na raiz do repositório:

```sh
node --test
node examples/fallback-demo.mjs
```

Não é necessário executar npm install. A demo produz dois registros: modelo
`mock/preferred` responde 429 e `mock/local` responde 200 na mesma sessão.
São respostas em memória, não servidores HTTP ou modelos reais.

## Política mínima

- Lista ordenada e explícita de modelos autorizados; nenhum catálogo é habilitado automaticamente.
- Cada modelo é tentado no máximo uma vez por operação; limite padrão de duas tentativas.
- 429/500/502/503/504 e timeout permitem fallback somente antes de resposta e sem efeitos possíveis.
- 401/403, entrada inválida, cota de duração desconhecida e metadados ausentes interrompem.
- Cooldown respeita o maior valor entre o padrão e Retry-After normalizado em milissegundos.
- Reinício com dispatch pendente bloqueia continuação automática.
- Retorno ao preferencial apenas em nova operação explicitamente concluída/reconciliada.

`src/policy.mjs` decide; não executa ferramentas, timers, HTTP ou persistência.
O consumidor deve persistir o estado de dispatch antes da chamada. `wait` é uma
decisão com horário, não um agendador. `nextOperation(previousCompleted: true)`
é uma afirmação confiável do chamador, nunca uma inferência feita a partir de erro.

O checkpoint do teste demonstra serialização e leitura em outro processo, não
durabilidade de produção, lock entre processos ou retomada de uma sessão OpenCode.
Histórico pertence ao host e não é reescrito pela política.

## Próximas etapas

1. Adaptador mínimo para os contratos públicos da versão fixada do OpenCode.
2. Teste end-to-end com endpoint local que injete falhas, ferramentas e reinício real.
3. Só depois, habilitar um plugin aprovado e provedores explicitamente autorizados.
4. Avaliar ai-memory para memória persistente, sem construir banco de memória próprio.

Veja [requisitos](docs/requirements.md), [ADR-001](docs/adr/001-composition.md),
[validação](docs/validation.md) e [contribuição](CONTRIBUTING.md).
