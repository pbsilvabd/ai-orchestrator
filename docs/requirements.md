# Escopo e critérios de aceitação

## Entrega 0: scaffold (atual)

- Política pura, allowlist explícita, limite de tentativas e cooldown.
- Bloqueio conservador para auth, cota desconhecida, resposta parcial e efeitos.
- Testes com dados sintéticos, checkpoint em arquivo e novo processo.
- Auditoria de fontes fixados e ADR; nenhum plugin ativado ou credencial versionada.

## Entrega 1: integração OpenCode (pendente)

Subetapa M1a concluída: normalização HTTP/Retry-After e testes loopback. M1b inclui
correlação, checkpoint e lock local; faltam cancelamento/orçamento. Consulte [roadmap](roadmap.md) e
[Definition of Done](definition-of-done.md); o destino prioritário é usar o projeto
para executar uma tarefa real no próprio repositório (M3).

| Cenário | Critério no host real |
| --- | --- |
| 429 antes da resposta | B assume na mesma sessão, com contexto e permissões íntegros |
| A e B falham | Termina sem loop ou tentativas além do orçamento |
| Reinício | Histórico preservado; dispatch incerto bloqueado |
| Falha após escrita | Nenhum replay automático da ação |
| A se recupera | Volta apenas em nova operação segura, após cooldown |

Usar endpoint local de falhas e ferramentas de teste, sem esgotar cotas reais.
O adaptador deve usar a normalização Retry-After (segundos/data HTTP), observar fronteiras de
efeitos, rejeitar capacidades incompatíveis e persistir antes do dispatch. Deve
tratar callbacks duplicados, concorrência, expiração e cancelamento. A política
atual presume um único chamador confiável e modelos compatíveis pré-validados.

## Fora deste incremento

Provedores reais, OAuth, APIs pagas, descoberta automática, execução multiagente,
classificação inteligente, memória semântica, UI, retry com backoff no mesmo modelo
e publicação do repositório privado. Não usar assinaturas como API genérica nem
alternar contas para contornar limites.
