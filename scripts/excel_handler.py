#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
Excel Handler Script
Processes Excel files for Testcase Sync
"""

import sys
import os
from datetime import datetime


def process_excel(file_path: str) -> None:
    """Process the Excel file and output results."""

    print(f"[{datetime.now().strftime('%H:%M:%S')}] Excel Handler Started")
    print(f"File path: {file_path}")

    # Check if file exists
    if not os.path.exists(file_path):
        print(f"ERROR: File not found - {file_path}", file=sys.stderr)
        sys.exit(1)

    # Get file info
    file_size = os.path.getsize(file_path)
    file_name = os.path.basename(file_path)

    print(f"File name: {file_name}")
    print(f"File size: {file_size:,} bytes")

    # TODO: Add actual Excel processing logic here
    # Example with openpyxl:
    # from openpyxl import load_workbook
    # wb = load_workbook(file_path)
    # for sheet_name in wb.sheetnames:
    #     print(f"Sheet: {sheet_name}")

    print(f"[{datetime.now().strftime('%H:%M:%S')}] Processing completed successfully")


def main():
    if len(sys.argv) < 2:
        print("Usage: python excel_handler.py <excel_file_path>", file=sys.stderr)
        sys.exit(1)

    file_path = sys.argv[1]
    process_excel(file_path)


if __name__ == "__main__":
    main()
