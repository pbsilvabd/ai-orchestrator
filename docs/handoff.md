# Ponto de retomada — 2026-11-02

M0/M1a/M1b concluídos no escopo local dos ADRs. Runner em src/runner.mjs combina
ledger/fallback/cancelamento/orçamento por invocação. M2 começou com smoke real
aprovado (sessão/contexto/troca explícita/deny-write). Ainda não há adaptador de fallback nem uso do projeto
para desenvolver a si mesmo. Leia roadmap.md e definition-of-done.md.

Executar: `node --test` e `node examples/fallback-demo.mjs` (Node 24).
Sem instalação de dependências ou credenciais. GitHub: pbsilvabd/ai-orchestrator,
branch main. Use o HEAD remoto como referência, verificando mudanças antes de editar.

Próximo incremento: M2, adaptador de fallback sem repetir prompts. O harness em
integration/opencode-smoke.mjs já inicializa o host e provider local; leia
integration/README.md. Expandir com falha 429 controlada e eventos/hooks, estabelecendo
fronteira segura antes de trocar modelo. Não usar outro `run` para reenviar prompt
falho. SDK retry só altera retry/delay, não o modelo readonly. Leia ADR-004/005.
Bug do harness resolvido: fechar child.stdin; run aguarda EOF antes do prompt.
Manter handle aberto durante a chamada; executar somente após select retornar
dispatch. Não remover locks automaticamente. Pending após crash continua bloqueado.

API atual: createState(sessionId), select(state, models, options),
success(state, dispatch), failure(state, dispatch, error, options), nextOperation(state).
Dispatch é o objeto original de select: transportar seus IDs no callback. Estado
versão 1 não é aceito. Não migrar silenciosamente eventos/checkpoints antigos.
43 testes locais e smoke real aprovados. Binário oficial 2.2.5 baixado e hash
verificado, mantido fora do repo em ../.audit/bin/opencode-2.2.5/opencode.exe.
Comando: node integration/opencode-smoke.mjs /caminho/absoluto/opencode.exe.
Ledger em src/ledger.mjs; runner em src/runner.mjs. Não há
autenticação de eventos nem garantia exactly-once/queda de energia. Referência
do Yuri registrada no roadmap para M3/M5; nada importado ainda.

Não ativar plugins auditados automaticamente. Manter fontes sincronizadas em
sources/ somente leitura. Nunca publicar credenciais ou tratar mocks como prova
de integração OpenCode. Objetivo prioritário: M3, primeira tarefa real no próprio repo.
