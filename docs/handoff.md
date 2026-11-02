# Ponto de retomada — 2026-11-02

M0/M1a concluídos. M1b parcial: sucesso explícito, bloqueio de nova operação e
correlação por sessão/operação/tentativa. Ainda não há executor nem uso do projeto
para desenvolver a si mesmo. Leia roadmap.md e definition-of-done.md.

Executar: `node --test` e `node examples/fallback-demo.mjs` (Node 24).
Sem instalação de dependências ou credenciais. GitHub: pbsilvabd/ai-orchestrator,
branch main. Use o HEAD remoto como referência, verificando mudanças antes de editar.

Próximo incremento: ledger atômico com lock por sessão. Persistir estado v2 ANTES
de chamar provedor/ferramenta, manter um escritor por sessão e testar processos
concorrentes, crash e checkpoint corrompido. Não remover lock supostamente antigo
automaticamente sem comprovar a morte do proprietário. Estado pendente após crash
continua bloqueado; não reexecutar para tentar descobrir o resultado.

API atual: createState(sessionId), select(state, models, options),
success(state, dispatch), failure(state, dispatch, error, options), nextOperation(state).
Dispatch é o objeto original de select: transportar seus IDs no callback. Estado
versão 1 não é aceito. Não migrar silenciosamente eventos/checkpoints antigos.
31 testes aprovados. A política não oferece lock, persistência nem autenticação de eventos.

Não ativar plugins auditados automaticamente. Manter fontes sincronizadas em
sources/ somente leitura. Nunca publicar credenciais ou tratar mocks como prova
de integração OpenCode. Objetivo prioritário: M3, primeira tarefa real no próprio repo.
