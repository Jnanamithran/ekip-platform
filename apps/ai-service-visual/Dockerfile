FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
# torch/torchvision are intentionally NOT pinned in requirements.txt —
# install the CUDA build so ColPali/Qwen2-VL can use the GPU reservation.
RUN pip install --no-cache-dir torch torchvision \
    --index-url https://download.pytorch.org/whl/cu121

COPY . .

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8001"]