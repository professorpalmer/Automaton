FROM python:3.12-slim

WORKDIR /app
COPY pyproject.toml README.md ./
COPY harness ./harness
COPY face ./face
COPY provision ./provision
RUN pip install --no-cache-dir -e .

ENV AUTOMATON_ROOT=/var/data
EXPOSE 10000
CMD ["sh", "-c", "automaton --host 0.0.0.0 --port ${PORT:-10000}"]
