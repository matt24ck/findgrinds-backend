FROM python:3.12-slim

# Non-root user; the service needs no filesystem access beyond its own code.
RUN useradd --create-home --uid 10001 app
WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY screening ./screening

ENV SCREENING_THRESHOLD=0.5 \
    PYTHONUNBUFFERED=1
USER app
EXPOSE 8010

# Bind on "::" (dual-stack): Railway's private network is IPv6-only, and plain
# docker/IPv4 still works. PORT is injected by most hosts; 8010 is the local default.
CMD ["sh", "-c", "uvicorn screening.app:app --host :: --port ${PORT:-8010}"]
