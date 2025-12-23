#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
Excel Reader - Read Excel file and return JSON data

Usage:
    python excel_reader.py <excel_path>

Output:
    JSON data with columns and rows
"""

import sys
import json

def read_excel(excel_path):
    """Read Excel file and return data as JSON"""
    try:
        import openpyxl
        wb = openpyxl.load_workbook(excel_path, read_only=True, data_only=True)
        sheet = wb.active

        headers = []
        rows = []

        for row_idx, row in enumerate(sheet.iter_rows(values_only=True)):
            if row_idx == 0:
                # First row is headers
                headers = [str(cell) if cell else f'col{i}' for i, cell in enumerate(row)]
            else:
                # Data rows
                if row[0]:  # Skip empty rows
                    row_data = {}
                    for i, cell in enumerate(row):
                        if i < len(headers):
                            # Convert to string, handle None
                            value = str(cell) if cell is not None else ''
                            # Clean up .0 suffix from numbers
                            if value.endswith('.0') and value[:-2].isdigit():
                                value = value[:-2]
                            row_data[headers[i]] = value
                    rows.append(row_data)

        wb.close()
        return {'success': True, 'headers': headers, 'rows': rows}
    except ImportError:
        return {'success': False, 'error': 'openpyxl not installed'}
    except Exception as e:
        return {'success': False, 'error': str(e)}

def main():
    if len(sys.argv) < 2:
        print(json.dumps({'success': False, 'error': 'Usage: python excel_reader.py <excel_path>'}))
        sys.exit(1)

    excel_path = sys.argv[1]
    result = read_excel(excel_path)
    print(json.dumps(result, ensure_ascii=False))

if __name__ == "__main__":
    main()
