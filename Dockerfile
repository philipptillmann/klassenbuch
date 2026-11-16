FROM python:3.13-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    KLASSENBUCH_BIND=0.0.0.0 \
    KLASSENBUCH_PORT=8085 \
    KLASSENBUCH_DATA_DIR=/var/lib/klassenbuch
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir --disable-pip-version-check -r requirements.txt \
    && groupadd --gid 1000 klassenbuch \
    && useradd --uid 1000 --gid klassenbuch --no-create-home klassenbuch \
    && install -d -m 0700 -o klassenbuch -g klassenbuch /var/lib/klassenbuch
COPY server.py config.py vault.py push_service.py ./
COPY dist/ ./dist/
# Git checkouts may use a restrictive umask; runtime sources must be readable.
RUN chmod -R a+rX /app
USER 1000:1000
EXPOSE 8085
HEALTHCHECK --interval=15s --timeout=5s --start-period=15s --retries=3 \
    CMD python -c "import urllib.request; assert urllib.request.urlopen('http://127.0.0.1:8085/healthz', timeout=3).read() == b'klassenbuch ok\\n'"
CMD ["python", "server.py", "--bind", "0.0.0.0", "--port", "8085", "--data-dir", "/var/lib/klassenbuch"]
