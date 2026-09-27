"""List River models available to RIVER_API_KEY. Prints model names only, never the key."""
import os
import sys

from forge import env

env.load()

key = os.environ.get("RIVER_API_KEY")
if not key:
    sys.exit("RIVER_API_KEY is not set (Emre sets it); dry-run mode still works")
import river_client as river

client = river.Client(api_key=key)
print("health:", client.health_check())
for m in client.get_capabilities():
    print(m)
