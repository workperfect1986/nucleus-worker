# Nucleus worker

Serviço privado de automação Playwright usado pela dashboard Studio Laser.

Endpoints:

- `GET /health`
- `POST /extract`
- `POST /production-stats`

As credenciais são recebidas na requisição, usadas somente durante a extração e descartadas ao final. Para implantação no Railway, mantenha este serviço sem domínio público e acesse-o pela rede privada.
