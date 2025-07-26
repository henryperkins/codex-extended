#!/bin/bash

# Dictation helper for Termius iOS
# Usage: ./dictate.sh [command]

echo "📱 Dictation Mode"
echo "Tap microphone on iOS keyboard and speak."
echo "Press Enter when done, or Ctrl+C to cancel."
echo "----------------------------------------"

if [ "$1" = "command" ]; then
    # Single line command mode
    read -p "Command: " cmd
    echo "Executing: $cmd"
    eval "$cmd"
else
    # Multiline text mode
    echo "Enter text (Ctrl+D when finished):"
    text=$(cat)
    echo -e "\n--- Your dictated text ---"
    echo "$text"
    echo "--- End ---"
    
    # Optionally save to clipboard or file
    echo -n "Save to file? (y/n): "
    read save
    if [ "$save" = "y" ]; then
        echo -n "Filename: "
        read filename
        echo "$text" > "$filename"
        echo "Saved to $filename"
    fi
fi