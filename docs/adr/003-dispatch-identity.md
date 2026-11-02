# ADR-003 — Identidade de dispatch e estado versão 2

Data: 2026-11-02. Status: adotada.

Confirmar somente modelo/pending permite que o resultado atrasado de uma operação
anterior finalize uma nova operação com o mesmo modelo. Cada operação agora recebe
UUID criado pelo runtime Node; cada tentativa recebe operationId mais ordinal.
O dispatch também carrega sessionId e model. success/failure verificam todos os
campos contra o estado atual antes de alterar qualquer coisa.

O consumidor deve transportar a identidade do dispatch original junto à chamada.
Reconstruí-la no callback com o estado atual anula a proteção. Identidade é
correlação, não autenticação: o consumidor continua sendo confiável.

Estado versão 2 rejeita checkpoints v1. Como não há runtime instalado nem dados de
produção conhecidos, não introduzimos migração automática que possa liberar uma
operação antiga incerta. Reconciliação de checkpoints antigos é manual.

Essas transições não garantem exclusão mútua: dois escritores que usam a mesma
cópia podem aceitar o mesmo evento. Ledger atômico e lock são o próximo gate,
antes de conectar callbacks reais do OpenCode. Nenhuma garantia exactly-once.
