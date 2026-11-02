# Roadmap — desenvolver o AI Orchestrator usando o próprio projeto

Atualizado em 2026-11-02. A ordem abaixo é por dependências e evidência, sem datas
prometidas antes de validar a integração. Responsável inicial: mantenedor com
assistência de agentes; aprovação de efeitos externos continua com o mantenedor.

## Destino

Usar AI Orchestrator sobre OpenCode para selecionar uma tarefa do seu próprio
backlog, executar mudanças em branch isolada, testar, revisar e entregar um diff
com evidências. Alternar apenas entre modelos autorizados quando seguro; preservar
histórico e decisões entre sessões; minimizar custo sem contornar limites.
O sistema deve conseguir melhorar a si mesmo sem conceder a si próprio permissões.

## Onde estamos

Política pura com allowlist, cooldown, limite de tentativas e bloqueio de replay
incerto; demo em memória; auditoria estática de dois plugins; checkpoint sintético.
Neste incremento: normalização HTTP e testes reais de transporte em loopback.
Ainda não existe executor, adaptador OpenCode, memória integrada ou ciclo autônomo.
O projeto ainda NÃO foi usado para desenvolver a si mesmo.

## Marcos

| Marco | Estado | Entrega e critério de saída |
| --- | --- | --- |
| M0 — Base verificável | Concluído | Política, auditoria fixada, ADR e suíte local sem APIs |
| M1a — Fronteira HTTP | Concluído neste incremento | Retry-After normalizado, casos inválidos bloqueados, 429/503→B e auth/efeitos→stop em loopback |
| M1b — Segurança operacional | Em andamento: sucesso explícito; demais itens pendentes | Ledger atômico, lock por sessão, correlação de tentativa, cancelamento e orçamento temporal; crash/concorrência comprovados por testes |
| M2 — Bootstrap no OpenCode 2.2.5 | Planejado; depende M1b | Adaptador mínimo, endpoint simulado, contexto/permissões preservados e cinco cenários de aceitação no host real |
| M3 — Primeiro uso no próprio projeto | Objetivo prioritário; depende M2 | Uma tarefa pequena real, dois modelos autorizados configurados, branch, diff, testes e relatório; revisão humana antes do merge |
| M4 — Memória e continuidade | Planejado; depende M3 | ai-memory avaliado/integrado; nova sessão recupera decisão e pendência sem confundir memória com estado de execução |
| M5 — Roteamento por capacidade/custo | Planejado; depende M3 | Catálogo separado de autorização, compatibilidade de ferramentas/contexto, métricas e limites medidos contra baseline |
| M6 — Multiagentes e release pública | Futuro; depende M4/M5 | Delegação limitada, revisão cruzada, orçamento global, documentação de instalação e release reproduzível |

Concluído é sempre no escopo da linha: M1a não comprova M2. Ver
[Definition of Done](definition-of-done.md) para gates comuns e de release.

## Próximo ciclo implementável: M1b

1. Definir identidade de operação/tentativa e eventos de sucesso/falha; rejeitar eventos atrasados.
2. Persistir estado antes do dispatch, com atualização atômica e lock de escritor único.
3. Provar bloqueio após crash, arquivo corrompido, lock concorrente e evento duplicado.
4. Acrescentar timeout/cancelamento sem assumir que interromper a conexão desfez efeitos.
5. Escrever ADR do adaptador e só então ligar os hooks públicos do OpenCode fixado.

## Experimento de bootstrap M2 → M3

- Selecionar uma tarefa de baixo impacto (ex.: acrescentar fixture e teste de regressão).
- Rodar primeiro com provedor simulado no OpenCode; testar falha injetada 429.
- Configurar modelos local/gratuito/assinatura apenas com autorização e disponibilidade verificadas.
- Rodar o mesmo fluxo com modelo real, orçamento limitado e sem credenciais no repositório.
- Registrar task ID, base/head, modelo escolhido, tentativas, comandos e resultados sanitizados.
- Critério de sucesso: diff útil revisado, testes aprovados, nenhuma alteração fora do escopo,
  sessão recuperável e nenhum efeito duplicado. Falha deve encerrar com estado explicável.
- Primeiro uso NÃO se considera concluído por executar testes diretamente neste chat.

## Limites para autoaperfeiçoamento

Agentes podem propor mudanças de código e políticas, mas não alterar sua própria
allowlist, orçamento, credenciais ou permissões durante a execução. Uma mudança
nesses controles exige revisão fora da execução afetada. Merge autônomo fica fora
do primeiro uso; a autorização do mantenedor para commits desta sessão não é uma
permissão permanente concedida ao futuro runtime.

## Riscos e decisões pendentes

| Risco/decisão | Resposta antes de avançar |
| --- | --- |
| SDK/plugins incompatíveis ou replay inseguro | Teste no host fixado; adaptar só o necessário, sem ativação automática |
| Provedor gratuito indisponível | Simulador obrigatório; fallback local depende de hardware e modelo disponíveis |
| Mudanças simultâneas no próprio código | Branch/base imutável por tarefa e runtime fixado durante execução |
| Testes aprovam a implementação errada | Casos de aceitação observáveis e revisão humana do diff |
| Privacidade/custo | Allowlist por tarefa e métricas sem conteúdo sensível; não habilitar faturamento implicitamente |

Atualizar este documento a cada marco junto com a evidência de validação.
Ponto de retomada de baixo custo: [handoff](handoff.md).
