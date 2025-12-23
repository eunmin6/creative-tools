#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
TC Generator - Generate testcase files from Excel

Usage:
    python tc_generator.py <excel_path> <output_dir>

Output format:
    PROGRESS:current/total - Progress update
    CREATED:filename - File created notification
"""

import sys
import os
import time
import re

def read_excel(excel_path):
    """Read Excel file and extract TC data"""
    try:
        import openpyxl
        wb = openpyxl.load_workbook(excel_path, read_only=True)
        sheet = wb.active

        testcases = []
        headers = []

        for row_idx, row in enumerate(sheet.iter_rows(values_only=True)):
            if row_idx == 0:
                # First row is headers
                headers = [str(cell) if cell else f'col{i}' for i, cell in enumerate(row)]
            else:
                # Data rows
                if row[0]:  # Skip empty rows
                    tc_data = {}
                    for i, cell in enumerate(row):
                        if i < len(headers):
                            tc_data[headers[i]] = str(cell) if cell else ''
                    testcases.append(tc_data)

        wb.close()
        return testcases, headers
    except ImportError:
        print("openpyxl not installed. Using mock data for testing.")
        # Mock data for testing without openpyxl
        return generate_mock_data()
    except Exception as e:
        print(f"Error reading Excel: {e}")
        return generate_mock_data()

def generate_mock_data():
    """Generate mock testcase data for testing"""
    testcases = []
    headers = ['TC-ID', 'Title', 'Description', 'Expected Result', 'Status']

    for i in range(1, 11):
        testcases.append({
            'TC-ID': f'TC-{i:03d}',
            'Title': f'Test Case {i}',
            'Description': f'This is the description for test case {i}',
            'Expected Result': f'Expected result for TC-{i:03d}',
            'Status': 'Draft'
        })

    return testcases, headers

def clean_number(value):
    """Remove decimal point from number string (e.g., 12345.0 -> 12345)"""
    if isinstance(value, str) and value.endswith('.0'):
        return value[:-2]
    return value

def convert_codebeamer_markup(text):
    """Convert CodeBeamer wiki markup and style markup to Markdown"""
    if not text or not isinstance(text, str):
        return text

    # ===== 스타일 마크업 제거 =====
    # %! 제거 먼저 (줄바꿈 마커)
    text = re.sub(r'%!', '', text)

    # \\ (위키 줄바꿈) 제거
    text = re.sub(r'\\\\', '', text)

    # {color:xxx}text{color} -> text
    text = re.sub(r'\{color:[^}]*\}(.*?)\{color\}', r'\1', text, flags=re.DOTALL)

    # {background:xxx}text{background} -> text
    text = re.sub(r'\{background:[^}]*\}(.*?)\{background\}', r'\1', text, flags=re.DOTALL)

    # {style:xxx}text{style} -> text
    text = re.sub(r'\{style:[^}]*\}(.*?)\{style\}', r'\1', text, flags=re.DOTALL)

    # {font:xxx}text{font} -> text
    text = re.sub(r'\{font:[^}]*\}(.*?)\{font\}', r'\1', text, flags=re.DOTALL)

    # %%(style;) 패턴 먼저 제거 (닫는 % 없이 스타일만 있는 경우)
    # 예: %%(white-space:nowrap;)text -> text
    text = re.sub(r'%%\([^)]*;\)', '', text)

    # %%(...)...%) 또는 %%(...)...% 형태 처리 (rgb() 같은 중첩 괄호 고려)
    def clean_style_block(match):
        content = match.group(0)
        # 마지막 ;) 를 찾아서 그 뒤의 내용 추출
        last_idx = content.rfind(';)')
        if last_idx != -1:
            result = content[last_idx + 2:]  # ;) 이후 내용
            result = result.rstrip('%').rstrip(')')
            return result
        return ''

    text = re.sub(r'%%\(.*?%\)?', clean_style_block, text, flags=re.DOTALL)

    # 남은 %%(...)만 제거
    text = re.sub(r'%%\([^)]*\)', '', text)

    # %%text%% -> text (다른 형태의 스타일)
    text = re.sub(r'%%([^%]*)%%', r'\1', text, flags=re.DOTALL)

    # 남은 홀로 있는 % 제거 (내용 뒤에 붙은 경우)
    text = re.sub(r'(?<=[a-zA-Z0-9_/\)])%(?=\s|$)', '', text)

    # ===== 2차 변환: 남은 CSS 속성 패턴 제거 =====
    # ;property:value;...;) 패턴 -> ) 뒤의 내용만 유지
    # 예: ";font-style:normal;...;float:none;)hmi_config" -> "hmi_config"
    def clean_remaining_css(match):
        return match.group(1)  # ;) 뒤의 내용만 반환

    text = re.sub(r';[a-zA-Z-]+:[^;]+(?:;[a-zA-Z-]+:[^;]+)*;\)([^;]*)', clean_remaining_css, text)

    # ===== 위키 마크업 변환 =====
    # 헤딩: h1. ~ h6. -> # ~ ######
    text = re.sub(r'^h1\.\s*(.*)$', r'# \1', text, flags=re.MULTILINE)
    text = re.sub(r'^h2\.\s*(.*)$', r'## \1', text, flags=re.MULTILINE)
    text = re.sub(r'^h3\.\s*(.*)$', r'### \1', text, flags=re.MULTILINE)
    text = re.sub(r'^h4\.\s*(.*)$', r'#### \1', text, flags=re.MULTILINE)
    text = re.sub(r'^h5\.\s*(.*)$', r'##### \1', text, flags=re.MULTILINE)
    text = re.sub(r'^h6\.\s*(.*)$', r'###### \1', text, flags=re.MULTILINE)

    # 볼드: __text__ -> **text**
    text = re.sub(r'__(.*?)__', r'**\1**', text)

    # 볼드: *text* (단어 경계) -> **text**
    text = re.sub(r'\*(\S.*?\S|\S)\*', r'**\1**', text)

    # 이탤릭: ''text'' -> *text*
    text = re.sub(r"''(.*?)''", r'*\1*', text)

    # 취소선: --text-- -> ~~text~~
    text = re.sub(r'--(.*?)--', r'~~\1~~', text)

    # 밑줄: ++text++ -> <u>text</u> (마크다운에서는 HTML 사용)
    text = re.sub(r'\+\+(.*?)\+\+', r'<u>\1</u>', text)

    # 링크: [text|url] -> [text](url)
    text = re.sub(r'\[([^|\]]+)\|([^\]]+)\]', r'[\1](\2)', text)

    # 단순 링크: [url] -> [url](url)
    text = re.sub(r'\[((https?://|www\.)[^\]]+)\]', r'[\1](\1)', text)

    # 코드 블록: {code}...{code} -> ```...```
    text = re.sub(r'\{code(?::[^}]*)?\}(.*?)\{code\}', r'```\n\1\n```', text, flags=re.DOTALL)

    # noformat 블록: {noformat}...{noformat} -> ```...```
    text = re.sub(r'\{noformat\}(.*?)\{noformat\}', r'```\n\1\n```', text, flags=re.DOTALL)

    # 패널: {panel}...{panel} -> blockquote
    text = re.sub(r'\{panel(?::[^}]*)?\}(.*?)\{panel\}', r'> \1', text, flags=re.DOTALL)

    # 인용: {quote}...{quote} -> blockquote
    text = re.sub(r'\{quote\}(.*?)\{quote\}', r'> \1', text, flags=re.DOTALL)

    # 불릿 리스트: * item -> - item (줄 시작)
    text = re.sub(r'^(\s*)\*\s+', r'\1- ', text, flags=re.MULTILINE)

    # 번호 리스트: # item -> 1. item (줄 시작)
    text = re.sub(r'^(\s*)#\s+', r'\g<1>1. ', text, flags=re.MULTILINE)

    # 수평선: ---- -> ---
    text = re.sub(r'^-{4,}$', r'---', text, flags=re.MULTILINE)

    # 테이블: ||header||header|| -> |header|header|
    text = re.sub(r'\|\|', r'|', text)

    # 이미지: !image.png! -> ![](image.png)
    text = re.sub(r'!([^!\s]+)!', r'![](\1)', text)

    # 남은 중괄호 태그 제거: {xxx} or {xxx:yyy}
    text = re.sub(r'\{[a-zA-Z]+(?::[^}]*)?\}', '', text)

    # ===== 이스케이프 문자 처리 =====
    # ~X -> X (틸드 이스케이프 제거)
    # ~_ -> _, ~* -> *, ~~ -> ~, ~[ -> [, ~] -> ], ~{ -> {, ~} -> } 등
    text = re.sub(r'~(.)', r'\1', text)

    # 여러 개의 빈 줄을 하나로
    text = re.sub(r'\n{3,}', '\n\n', text)

    return text.strip()

def is_folder_type(tc_data):
    """Check if this TC is a Folder type (should be skipped)"""
    # Check common column names for type
    for key in ['Type', 'type', 'TYPE', '유형', 'Category', 'category']:
        value = tc_data.get(key, '').strip().lower()
        if value == 'folder':
            return True
    return False

def create_tc_file(tc_data, output_dir, headers):
    """Create a single TC file"""
    # Get TC ID from first column or generate one
    tc_id = tc_data.get('TC-ID') or tc_data.get(headers[0]) or 'unknown'
    tc_id = clean_number(tc_id)  # Remove .0 suffix
    tc_id = tc_id.replace('/', '-').replace('\\', '-').replace(':', '-')

    filename = f"{tc_id}.md"
    filepath = os.path.join(output_dir, filename)

    # Write TC content
    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(f"# {tc_id}\n")
        f.write("=" * 50 + "\n\n")

        for key, value in tc_data.items():
            if value:
                value = clean_number(value)  # Remove .0 from numbers
                value = convert_codebeamer_markup(value)  # Convert wiki/style markup to markdown
                f.write(f"## {key}\n")
                f.write(f"{value}\n\n")

    return filename

def main():
    if len(sys.argv) < 3:
        print("Usage: python tc_generator.py <excel_path> <output_dir>")
        sys.exit(1)

    excel_path = sys.argv[1]
    project_dir = sys.argv[2]
    output_dir = os.path.join(project_dir, 'testcase')

    print(f"Reading Excel: {excel_path}")
    print(f"Output directory: {output_dir}")

    # Create output directory
    if not os.path.exists(output_dir):
        os.makedirs(output_dir)
        print(f"Created directory: {output_dir}")

    # Read Excel data
    testcases, headers = read_excel(excel_path)
    original_total = len(testcases)

    if original_total == 0:
        print("No testcases found in Excel file.")
        sys.exit(1)

    print(f"Found {original_total} testcases in Excel")

    # Folder 타입 제외
    testcases = [tc for tc in testcases if not is_folder_type(tc)]
    filtered_count = original_total - len(testcases)
    if filtered_count > 0:
        print(f"Filtered out {filtered_count} Folder items")

    total = len(testcases)

    if total == 0:
        print("No testcases to generate (all were Folder type).")
        sys.exit(1)

    print(f"Will generate {total} TC files")

    # 테스트를 위해 최대 30개로 제한
    MAX_FILES = 30
    if total > MAX_FILES:
        print(f"Limiting to {MAX_FILES} files for testing")
        testcases = testcases[:MAX_FILES]
        total = MAX_FILES

    # Generate TC files
    created_count = 0
    for i, tc_data in enumerate(testcases, 1):
        # Progress update
        print(f"PROGRESS:{i}/{total}", flush=True)

        # Create file
        filename = create_tc_file(tc_data, output_dir, headers)
        created_count += 1

        # File created notification
        print(f"CREATED:{filename}", flush=True)

        # Small delay for visual effect
        time.sleep(0.2)

    print(f"\nCompleted! Generated {total} testcase files.")

if __name__ == "__main__":
    main()
