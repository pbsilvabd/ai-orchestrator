# AI Orchestrator

Scaffold incremental de orquestração sobre OpenCode. Licença MIT.

## Estado desta entrega

Implementado: política pura de fallback, normalização de falhas HTTP/Retry-After,
demo com dois provedores simulados e testes locais, incluindo transporte HTTP em
loopback, sem dependências. **Não é um plugin instalado nem um MVP integrado ao OpenCode.**
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
decisão com horário, não um agendador. O chamador confiável confirma o resultado
com `success(state, dispatch)`; somente então `nextOperation(state)` é permitido.
O antigo argumento `previousCompleted: true` não libera dispatch pendente.
Estado versão 2: cada operação recebe um UUID; cada dispatch inclui sessionId,
operationId e attemptId. `success` e `failure` exigem o dispatch original retornado
por `select`, não apenas o modelo. Não reconstruir sua identidade a partir do
estado atual quando um callback chegar. Checkpoints versão 1 são rejeitados e
exigem reconciliação manual, sem migração automática de operações pendentes.
Para persistência/exclusão entre processos, use `openSession(directory, sessionId)`
de `src/ledger.mjs`. O handle oferece `select(models, options)`, `success(dispatch)`,
`failure(dispatch, error, options)`, `nextOperation()`, `snapshot()` e `close()`.
Mantenha-o aberto durante a chamada e feche em finally. Só chame o provedor depois
que select retornar action=dispatch: o checkpoint já estará gravado. Erros de
persistência invalidam o handle. Leia [ADR-004](docs/adr/004-local-ledger.md).

Os testes incluem checkpoint e lock entre processos locais, mas não retomada de
sessão OpenCode ou durabilidade sob queda de energia. Histórico pertence ao host.
Use diretório local confiável, com escritores cooperativos; NFS/SMB e diretórios
controlados por terceiros não são suportados. Locks após crash exigem reconciliação
manual; não são removidos automaticamente.

## Plano de desenvolvimento

`runOperation` em `src/runner.mjs` combina ledger, fallback, cancelamento e limite
de duração. Recebe directory, sessionId, models, invoke, budgetMs (padrão 30000),
maxAttempts (padrão 2) e signal opcional. O adaptador invoke recebe dispatch/signal
e retorna `{ok:true,value}` ou `{ok:false,error}`. Nenhum adaptador OpenCode está
instalado ainda. Veja [ADR-005](docs/adr/005-operation-runner.md) para limites:
abort não desfaz efeitos, o prazo não interrompe código síncrono e não é persistido
entre invocações. Após cancelamento em voo, a sessão exige reconciliação.

O objetivo prioritário é **desenvolver este projeto usando ele mesmo**, com uma
primeira tarefa real em branch isolada e revisão humana. O projeto ainda não tem
executor próprio. Consulte o [roadmap](docs/roadmap.md) e a
[Definition of Done](docs/definition-of-done.md) para estado, dependências e gates.

## Próximas etapas

1. Validar o contrato do adaptador OpenCode sobre o runner local implementado.
2. Adaptador OpenCode 2.2.5 e teste end-to-end com falhas, ferramentas e reinício real.
3. Primeiro uso no próprio repositório com modelos explicitamente autorizados.
4. Memória com ai-memory, roteamento por capacidade/custo e multiagentes em etapas.

`src/http-failure.mjs` aceita Retry-After em segundos inteiros ou IMF-fixdate canônico.
Valores inválidos, overflow e formatos antigos são rejeitados conservadoramente.
Não é um parser HTTP completo. A segurança de repetir deve vir do host; um status
429 sozinho não comprova ausência de efeitos. Corpos/headers privados não são copiados.

Veja [requisitos](docs/requirements.md), [ADR-001](docs/adr/001-composition.md),
[validação](docs/validation.md) e [contribuição](CONTRIBUTING.md).
