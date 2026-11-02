# ADR-001 — Composição e política verificável antes da integração

Data: 2026-11-02. Status: adotada para o scaffold.

## Contexto

O projeto pretende reutilizar OpenCode, plugins e ai-memory. A inspeção dos plugins
encontrou comportamentos incompatíveis com nossa política conservadora (auth como
fallback, conversão de partes e replay). Compatibilidade declarada não comprova
segurança sob efeitos colaterais ou reinício.

## Decisão

Fixar OpenCode 2.2.5 como referência de contrato. Não modificar seu core nem ativar
plugins automaticamente. Entregar uma política pura em JavaScript ESM e uma suíte
Node sem bibliotecas externas, como especificação executável para o futuro adaptador.
Não construir proxy, router de produção, multiagentes ou memória neste incremento.

Fallback é limitado a modelos autorizados, sem retries no mesmo modelo nesta fase.
Isso elimina loops e backoff ativo do escopo inicial; cooldown e Retry-After são
representados como timestamps. Cotas sem reset conhecido exigem intervenção.
Não degradar silenciosamente partes de mensagem para obter sucesso.

Estado operacional é distinto de memória semântica. Um dispatch persistido ainda
pendente após crash exige reconciliação. Nenhuma promessa de exactly-once é feita.
ai-memory permanece candidato futuro; não é dependência instalada nem substituto
para ledger operacional e controle de concorrência.

## Consequências

Testes são baratos e reproduzíveis, mas não aprovam nenhum plugin nem demonstram
continuidade real no OpenCode. Há manutenção de uma pequena especificação própria;
ela só deve virar código de integração onde os componentes existentes forem insuficientes.
Antes de produção: persistência atômica, locks, validação de capacidades/mensagens,
orçamento temporal, cancelamento e prova de segurança de replay.
