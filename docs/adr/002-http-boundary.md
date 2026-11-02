# ADR-002 — Separar HTTP de segurança de replay

Data: 2026-11-02. Status: adotada para M1a.

Normalizar status e Retry-After em um módulo puro separado da política. Segundos
inteiros e IMF-fixdate canônico são aceitos; header ausente usa zero (a política
ainda aplica cooldown). Valor inválido/overflow bloqueia fallback, sem truncar um
prazo longo para retentar cedo demais. Formatos de data obsoletos são rejeitados
nesta etapa; não declaramos conformidade completa de parser HTTP.

Referência: [RFC 9110, seção 10.2.3](https://www.rfc-editor.org/rfc/rfc9110.html#section-10.2.3).

O normalizador nunca deduz ausência de efeitos de um código HTTP. O host deve
fornecer metadados de segurança; omissão bloqueia replay. Não encaminhar corpo,
URLs ou headers arbitrários ao estado/log. Testes de transporte usam somente
127.0.0.1 e fixtures sem ferramentas, portanto não aprovam o adaptador OpenCode.
