# EduGrade - Dockerfile
# Multi-stage build for optimized image size

FROM python:3.12-slim as builder

# Install build dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    && rm -rf /var/lib/apt/lists/*

# Create virtual environment
RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# Copy and install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt


# Production stage
FROM python:3.12-slim

# Create non-root user for security
RUN useradd -m -u 1000 edugrade && \
    mkdir -p /app/data /app/backups && \
    chown -R edugrade:edugrade /app

# Copy virtual environment from builder
COPY --from=builder /opt/venv /opt/venv

# Set working directory
WORKDIR /app

# Copy application files
COPY --chown=edugrade:edugrade . .

# Switch to non-root user
USER edugrade

# Set environment variables
ENV PATH="/opt/venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    QUART_APP=app.py

# Expose port
EXPOSE 1601

# Create volume for persistent data
VOLUME ["/app/data"]

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:1601/api/version')" || exit 1

# Run with hypercorn for production
CMD ["hypercorn", "app:app", "--bind", "0.0.0.0:1601", "--workers", "1"]
