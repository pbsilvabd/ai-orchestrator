# Ponto de retomada — 2026-11-02

M0/M1a concluídos. M1b parcial: confirmação explícita de sucesso e bloqueio de
nova operação enquanto não concluída. Ainda não há executor nem uso do projeto
para desenvolver a si mesmo. Leia roadmap.md e definition-of-done.md.

Executar: `node --test` e `node examples/fallback-demo.mjs` (Node 24).
Sem instalação de dependências ou credenciais. GitHub: pbsilvabd/ai-orchestrator,
branch main. Use o HEAD remoto como referência, verificando mudanças antes de editar.

Próximo incremento pequeno: adicionar IDs de operação/tentativa aos retornos de
dispatch e exigir esses IDs em success/failure. Testar evento atrasado do mesmo
modelo após início de outra operação e callback duplicado. Só depois implementar
ledger atômico e lock. Hoje a política assume um chamador síncrono confiável;
verificar apenas modelo/pending não protege contra eventos de operações antigas.

Não ativar plugins auditados automaticamente. Manter fontes sincronizadas em
sources/ somente leitura. Nunca publicar credenciais ou tratar mocks como prova
de integração OpenCode. Objetivo prioritário: M3, primeira tarefa real no próprio repo.
