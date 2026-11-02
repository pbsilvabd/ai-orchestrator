# Definition of Done

## Uma mudança está concluída quando

- [ ] Problema, escopo e critério observável estão descritos no commit/PR/documentação.
- [ ] Implementação permanece dentro do marco; limitações e trabalho restante são explícitos.
- [ ] Testes de comportamento e falha relevantes passam; regressões da suíte completa passam.
- [ ] Comandos, ambiente e resultados constam em docs/validation.md.
- [ ] Sem APIs pagas obrigatórias, credenciais ou dados privados em fontes/logs/fixtures.
- [ ] Falhas desconhecidas não autorizam replay; auth/permissões não são contornadas.
- [ ] README, requisitos e roadmap refletem o resultado; decisões arquiteturais têm ADR quando necessário.
- [ ] Diff revisto, licença preservada, commit publicado e estado remoto verificado; sem force push.

Commit direto na main pode ser usado quando autorizado pelo mantenedor, como neste
ciclo. Isso não dispensa testes/revisão nem altera as permissões do futuro agente.

## Níveis de evidência

| Nível | O que comprova | O que não comprova |
| --- | --- | --- |
| Unitário | Decisão da política e normalização de entradas | Host, rede, persistência de produção |
| HTTP local | Headers/status reais e seleção com fixture controlada | Ferramentas ou sessões reais OpenCode |
| Integração OpenCode | Hooks, fila, contexto, permissões e falhas no host fixado | Qualidade/custo de modelo real |
| Uso no próprio projeto | Tarefa real produz diff e evidências sob supervisão | Autonomia irrestrita ou segurança universal |

## MVP integrado pronto (M2)

- [ ] Instalação e execução reproduzíveis com OpenCode 2.2.5 fixado.
- [ ] 429 antes da resposta troca A→B sem perder contexto/permissões.
- [ ] Dois modelos falhando terminam dentro dos limites.
- [ ] Reinício preserva histórico e bloqueia dispatch cujo resultado é incerto.
- [ ] Falha após escrita/efeito externo não repete a ação.
- [ ] Retorno a A só em nova operação segura após cooldown.
- [ ] Auth, capacidade incompatível, cancelamento, eventos duplicados e concorrência têm testes.

## Primeiro uso no próprio projeto pronto (M3)

- [ ] Uma tarefa do backlog foi executada pelo projeto sobre OpenCode, não apenas por este chat.
- [ ] Provedores autorizados e runtime/versionamento registrados, sem divulgar credenciais.
- [ ] Mudanças isoladas em branch, base registrada e diff limitado à tarefa.
- [ ] Testes executados pelo fluxo, resultados verificáveis e revisão humana concluída.
- [ ] Relatório contém tentativas, falhas, arquivos e custo conhecido (ou explicitamente desconhecido).
- [ ] Há procedimento de recuperação e nenhuma elevação de permissão pelo agente.

## Release pública pronta

M3 demonstrado, instalação limpa reproduzida, documentação de limites e privacidade,
licença/dependências auditadas e smoke test por plataforma declarada. Tornar o
repositório público e habilitar provedores são decisões explícitas do mantenedor.
Nenhuma versão estável será anunciada somente porque os testes unitários passam.
