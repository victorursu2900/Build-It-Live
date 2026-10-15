"""Compatibility entry point for the color-only Node palette generator."""
from pathlib import Path
import subprocess

if __name__ == "__main__":
    subprocess.run(["node", str(Path(__file__).with_suffix(".mjs"))], check=True)
