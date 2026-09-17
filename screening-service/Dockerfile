FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY screening ./screening
ENV SCREENING_THRESHOLD=0.5
EXPOSE 8010
CMD ["uvicorn", "screening.app:app", "--host", "0.0.0.0", "--port", "8010"]
