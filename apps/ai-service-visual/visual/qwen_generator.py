"""
Qwen2-VL visual question answering — Phase 2 visual pipeline.

Takes page images retrieved by ColPali and generates grounded answers.
Uses 4-bit quantization to fit in 6GB VRAM alongside ColPali.

VRAM strategy for RTX 3050 6GB:
  - ColPali (inference only): ~1.5GB
  - Qwen2-VL-7B (4-bit quantized): ~4.5GB
  - Total: ~6GB — tight but workable if models are loaded lazily
  - Never keep both ColPali and Qwen2-VL loaded at the same time.
"""

import os
import torch
from PIL import Image

from transformers import Qwen2VLForConditionalGeneration, AutoProcessor

QWEN_MODEL = os.getenv("QWEN_MODEL", "Qwen/Qwen2-VL-7B-Instruct")

_model = None
_processor = None


def get_qwen():
    """Lazy-load Qwen2-VL with 4-bit quantization (falls back to float16)."""
    global _model, _processor
    if _model is None:
        print("Loading Qwen2-VL model (first time — downloads ~4GB)...")

        # Try 4-bit quantization via bitsandbytes first
        try:
            from transformers import BitsAndBytesConfig
            quantization_config = BitsAndBytesConfig(
                load_in_4bit=True,
                bnb_4bit_compute_dtype=torch.float16,
            )
            _model = Qwen2VLForConditionalGeneration.from_pretrained(
                QWEN_MODEL,
                quantization_config=quantization_config,
                device_map="cuda" if torch.cuda.is_available() else "cpu",
            )
        except Exception:
            # Fallback: float16 without 4-bit (needs more VRAM)
            print("4-bit quantization unavailable, using float16...")
            _model = Qwen2VLForConditionalGeneration.from_pretrained(
                QWEN_MODEL,
                torch_dtype=torch.float16,
                device_map="auto",
            )

        _processor = AutoProcessor.from_pretrained(
            QWEN_MODEL,
            min_pixels=256 * 28 * 28,
            max_pixels=1280 * 28 * 28,
        )
        print("Qwen2-VL loaded.")
    return _model, _processor


def answer_from_images(
    question: str,
    page_images: list,
    filenames: list[str],
    page_nums: list[int],
    document_ids: list[str] | None = None,
) -> dict:
    """
    Generate a grounded answer from retrieved page images.
    RBAC is enforced upstream — only authorized page images reach here.
    """
    model, processor = get_qwen()

    messages = [{
        "role": "user",
        "content": [
            *[{"type": "image", "image": img} for img in page_images],
            {
                "type": "text",
                "text": (
                    "You are an enterprise knowledge assistant. "
                    "Answer the following question using ONLY the provided document pages. "
                    "Be specific and cite which page your answer comes from. "
                    "If the answer is not visible in any of the pages, say clearly: "
                    "'I could not find this information in the provided pages.'\n\n"
                    f"Question: {question}"
                )
            }
        ]
    }]

    text = processor.apply_chat_template(
        messages, tokenize=False, add_generation_prompt=True
    )

    inputs = processor(
        text=[text],
        images=page_images,
        return_tensors="pt",
        padding=True
    )
    inputs = {k: v.to(model.device) for k, v in inputs.items()}

    with torch.no_grad():
        output_ids = model.generate(
            **inputs,
            max_new_tokens=512,
            temperature=0.1,
            do_sample=False,
        )

    answer_ids = output_ids[:, inputs["input_ids"].shape[1]:]
    answer = processor.batch_decode(answer_ids, skip_special_tokens=True)[0]

    return {
        "answer": answer,
        "citations": [
            {
                "filename": fn,
                "page_num": pn,
                "document_id": document_ids[i] if document_ids else "unknown",
                "text": f"[Visual content — page {pn} of {fn}]",
                "type": "visual",
            }
            for i, (fn, pn) in enumerate(zip(filenames, page_nums))
        ],
        "model": QWEN_MODEL,
        "pipeline": "visual",
    }