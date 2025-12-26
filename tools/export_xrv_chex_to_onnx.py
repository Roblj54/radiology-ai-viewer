import sys
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

import torch
import torchxrayvision as xrv

pt_path = r"C:\Users\J-ROB\OneDrive\Documentos\Desktop\nodejs\radiology-ai-viewer\public\models\torchxrv_densenet121_res224_chex.pt"
onnx_path = r"C:\Users\J-ROB\OneDrive\Documentos\Desktop\nodejs\radiology-ai-viewer\public\models\torchxrv_densenet121_res224_chex.onnx"

model = xrv.models.DenseNet(weights=None)

# Trusted source only. Needed for this checkpoint format in PyTorch 2.6+
ckpt = torch.load(pt_path, map_location="cpu", weights_only=False)

if isinstance(ckpt, torch.nn.Module):
    sd = ckpt.state_dict()
elif isinstance(ckpt, dict) and "state_dict" in ckpt:
    sd = ckpt["state_dict"]
elif isinstance(ckpt, dict):
    sd = ckpt
else:
    raise RuntimeError(f"Unrecognized checkpoint format: {type(ckpt)}")

def strip_prefix(state_dict, prefix):
    if any(k.startswith(prefix) for k in state_dict.keys()):
        return {k[len(prefix):]: v for k, v in state_dict.items()}
    return state_dict

sd = strip_prefix(sd, "module.")
sd = strip_prefix(sd, "model.")
sd = strip_prefix(sd, "net.")

missing, unexpected = model.load_state_dict(sd, strict=False)
model.eval()

dummy = torch.zeros(1, 1, 224, 224, dtype=torch.float32)

# Use legacy exporter to avoid the new dynamo exporter path
torch.onnx.export(
    model,
    dummy,
    onnx_path,
    input_names=["input"],
    output_names=["logits"],
    opset_version=18,
    do_constant_folding=True,
    dynamo=False
)

print("OK exported:", onnx_path)
print("Missing keys:", len(missing))
print("Unexpected keys:", len(unexpected))
