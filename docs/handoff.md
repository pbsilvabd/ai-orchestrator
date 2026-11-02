# Ponto de retomada — 2026-11-02

M0/M1a/M1b concluídos no escopo local dos ADRs. Runner em src/runner.mjs combina
ledger/fallback/cancelamento/orçamento por invocação. Ainda não há integração OpenCode nem uso do projeto
para desenvolver a si mesmo. Leia roadmap.md e definition-of-done.md.

Executar: `node --test` e `node examples/fallback-demo.mjs` (Node 24).
Sem instalação de dependências ou credenciais. GitHub: pbsilvabd/ai-orchestrator,
branch main. Use o HEAD remoto como referência, verificando mudanças antes de editar.

Próximo incremento: M2, contrato/adaptador mínimo OpenCode 2.2.5 com endpoint
simulado. Inspecionar SDK fixado e definir quem controla o loop, preservando fila,
contexto e permissões sem duplicar prompts. Leia ADR-004/005 antes de integrar.
Manter handle aberto durante a chamada; executar somente após select retornar
dispatch. Não remover locks automaticamente. Pending após crash continua bloqueado.

API atual: createState(sessionId), select(state, models, options),
success(state, dispatch), failure(state, dispatch, error, options), nextOperation(state).
Dispatch é o objeto original de select: transportar seus IDs no callback. Estado
versão 1 não é aceito. Não migrar silenciosamente eventos/checkpoints antigos.
43 testes aprovados. Ledger em src/ledger.mjs; runner em src/runner.mjs. Não há
autenticação de eventos nem garantia exactly-once/queda de energia. Referência
do Yuri registrada no roadmap para M3/M5; nada importado ainda.

Não ativar plugins auditados automaticamente. Manter fontes sincronizadas em
sources/ somente leitura. Nunca publicar credenciais ou tratar mocks como prova
de integração OpenCode. Objetivo prioritário: M3, primeira tarefa real no próprio repo.
