import ast, sys
for f in ["main.py", "embeddings/qdrant_client.py"]:
    try:
        ast.parse(open(f).read())
        print(f"{f}: syntax OK")
    except SyntaxError as e:
        print(f"{f}: {e}")
        sys.exit(1)