#!/bin/bash
# Helper script to add, commit, and push codebase changes
MSG=${1:-"style: update layout and configuration settings"}
git add .
git commit -m "$MSG"
git push
