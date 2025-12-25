#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
Categorizer - Categorize testcase files and generate Excel reports (Multi-step)

Usage:
    python categorizer.py <testcase_dir> <options_json>

Options JSON format:
    {"automation": true, "module": true, "testMethod": true, "implType": true}

Output:
    Step 1: .vvu.category(1).xlsx - Raw categorization
    Step 2: .vvu.category(2).xlsx - Module grouping
    Step 3: .vvu.category(3).xlsx - Refinement
    Final:  .vvu.category.xlsx - Final version
"""

import sys
import os
import re
import json

def parse_md_file(filepath):
    """Parse a markdown testcase file and extract sections"""
    sections = {}
    current_section = None
    current_content = []

    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            lines = f.readlines()
    except Exception as e:
        print(f"Error reading {filepath}: {e}", file=sys.stderr)
        return sections

    for line in lines:
        if line.startswith('## '):
            if current_section:
                sections[current_section] = '\n'.join(current_content).strip()
            current_section = line[3:].strip()
            current_content = []
        elif current_section:
            current_content.append(line.rstrip())

    if current_section:
        sections[current_section] = '\n'.join(current_content).strip()

    return sections


def extract_automation_status(sections):
    """Extract automation status from ## Automation field"""
    automation = sections.get('Automation', '').strip()
    if not automation:
        return 'Unknown'
    return automation


def extract_module_name(sections):
    """Extract module name from ## Name field"""
    name = sections.get('Name', '')
    if not name:
        return 'Unknown'

    # Remove bracket prefixes like [SWQT][MMC]
    name = re.sub(r'^\s*(\[[^\]]*\]\s*)+', '', name)

    # Extract module name (before first ' - ')
    parts = name.split(' - ')
    if parts:
        module = parts[0].strip()
        return module

    return 'Unknown'


def get_module_group(module_name):
    """Extract module group from full module name
    e.g., 'ADAS_Settings_Parking Assistance' -> 'ADAS_Settings'
          'ADAS_Full_Auto_Parking_(Nissan/Infiniti)' -> 'ADAS_Full_Auto_Parking'
    """
    if module_name == 'Unknown':
        return 'Unknown'

    # Replace spaces with underscores for consistency
    normalized = module_name.replace(' ', '_')

    # Split by underscore
    parts = normalized.split('_')

    # Take first 2-3 parts based on pattern
    # If starts with ADAS, take 3 parts (ADAS_Something_Something)
    if len(parts) >= 3 and parts[0] == 'ADAS':
        # Check if third part looks like a continuation
        group = '_'.join(parts[:3])
        # If the group ends with common suffixes, include them
        if len(parts) > 3 and parts[3] in ['App', 'Component', 'Parking', 'Settings']:
            group = '_'.join(parts[:4])
        return group
    elif len(parts) >= 2:
        return '_'.join(parts[:2])
    else:
        return normalized


def extract_test_methods(sections):
    """Extract test methods/technologies from test steps and description"""
    methods = set()

    text_to_analyze = ' '.join([
        sections.get('Description', ''),
        sections.get('Test Steps.Action', ''),
        sections.get('Test Steps.Expected result', ''),
        sections.get('Precondition', ''),
        sections.get('Equipment', ''),
        sections.get('Verifies', '')
    ]).lower()

    method_patterns = {
        'ADB': [r'\badb\b', r'adb shell', r'adb reboot'],
        'CAN': [r'\bcan\b', r'canat', r'can signal', r'can message'],
        'Log': [r'\blog\b', r'logcat', r'check log', r'log file'],
        'HMI': [r'\bhmi\b', r'screen', r'display', r'touch', r'button'],
        'Configuration': [r'configuration', r'config', r'parameter', r'setting'],
        'DiagAdb': [r'diagadb'],
        'Reboot': [r'reboot', r'restart'],
        'Signal': [r'signal', r'rx signal', r'tx signal'],
        'Database': [r'database', r'\bdb\b', r'sql'],
        'API': [r'\bapi\b', r'rest', r'http'],
        'File': [r'file check', r'read file', r'write file', r'file system'],
        'Audio': [r'audio', r'sound', r'speaker', r'volume'],
        'Video': [r'video', r'camera', r'display'],
        'Network': [r'network', r'wifi', r'bluetooth', r'ethernet'],
        'GPS': [r'\bgps\b', r'location', r'navigation'],
        'Power': [r'power', r'battery', r'voltage', r'acc on', r'acc off'],
    }

    for method, patterns in method_patterns.items():
        for pattern in patterns:
            if re.search(pattern, text_to_analyze):
                methods.add(method)
                break

    return methods


def extract_implementation_type(sections):
    """Extract implementation type based on test patterns"""
    impl_types = set()

    action = sections.get('Test Steps.Action', '').lower()
    expected = sections.get('Test Steps.Expected result', '').lower()
    description = sections.get('Description', '').lower()

    combined = f"{action} {expected} {description}"

    impl_patterns = {
        'Config_Set_Check': [
            (r'set.*config', r'check.*config'),
            (r'configuration.*set', r'check.*value'),
            (r'set.*parameter', r'get.*parameter'),
        ],
        'CAN_Signal_Verify': [
            (r'send.*can', r'verify'),
            (r'can.*signal', r'check'),
            (r'rx.*signal', r'display'),
        ],
        'HMI_Interaction': [
            (r'touch|tap|press|click', r'screen|display|hmi'),
            (r'button', r'popup|dialog|menu'),
        ],
        'Log_Check': [
            (r'log', r'check|verify|confirm'),
            (r'logcat', r'message'),
        ],
        'State_Transition': [
            (r'change.*state', r''),
            (r'transition', r''),
            (r'mode.*change', r''),
        ],
        'Value_Verification': [
            (r'get|read', r'value|verify|confirm'),
            (r'check.*value', r''),
        ],
        'Condition_Test': [
            (r'when|if|condition', r'then|should|expect'),
        ],
        'Sequence_Test': [
            (r'step\s*1.*step\s*2', r''),
            (r'first.*then.*finally', r''),
        ],
        'Boundary_Test': [
            (r'minimum|maximum|boundary|limit', r''),
            (r'min.*max', r''),
        ],
        'Error_Handling': [
            (r'error|fail|invalid|wrong', r'message|handle|recover'),
        ],
    }

    for impl_type, pattern_pairs in impl_patterns.items():
        for patterns in pattern_pairs:
            if isinstance(patterns, tuple):
                if len(patterns) == 2:
                    p1, p2 = patterns
                    if re.search(p1, combined):
                        if not p2 or re.search(p2, combined):
                            impl_types.add(impl_type)
                            break
            else:
                if re.search(patterns, combined):
                    impl_types.add(impl_type)
                    break

    if not impl_types:
        impl_types.add('Generic')

    return impl_types


def get_impl_group(impl_types):
    """Get a single implementation group from multiple implementation types.

    Groups (priority order - first match wins):
    1. HMI: HMI_Interaction
    2. Signal_CAN: CAN_Signal_Verify
    3. Config_Log: Config_Set_Check, Log_Check, Value_Verification
    4. Flow_State: State_Transition, Sequence_Test, Condition_Test
    5. Edge_Case: Boundary_Test, Error_Handling
    6. Generic: fallback
    """
    # Priority-based grouping - each TC gets exactly ONE group
    if 'HMI_Interaction' in impl_types:
        return 'HMI'
    elif 'CAN_Signal_Verify' in impl_types:
        return 'Signal_CAN'
    elif impl_types & {'Config_Set_Check', 'Log_Check', 'Value_Verification'}:
        return 'Config_Log'
    elif impl_types & {'State_Transition', 'Sequence_Test', 'Condition_Test'}:
        return 'Flow_State'
    elif impl_types & {'Boundary_Test', 'Error_Handling'}:
        return 'Edge_Case'
    else:
        return 'Generic'


def categorize_testcases(testcase_dir, options):
    """Main categorization function"""
    results = []

    all_automation = set()
    all_modules = set()
    all_module_groups = set()
    all_methods = set()
    all_impl_types = set()
    all_impl_groups = set()

    md_files = [f for f in os.listdir(testcase_dir) if f.endswith('.md')]
    total = len(md_files)

    if total == 0:
        print("No .md files found in testcase directory.")
        return None

    print(f"Found {total} testcase files to categorize")

    for i, filename in enumerate(md_files, 1):
        filepath = os.path.join(testcase_dir, filename)
        print(f"PROGRESS:{i}/{total}", flush=True)

        sections = parse_md_file(filepath)
        tc_id = filename.replace('.md', '')

        tc_data = {
            'TC_ID': tc_id,
            'filename': filename,
        }

        if options.get('automation', True):
            automation = extract_automation_status(sections)
            tc_data['automation'] = automation
            all_automation.add(automation)

        if options.get('module', True):
            module = extract_module_name(sections)
            module_group = get_module_group(module)
            tc_data['module'] = module
            tc_data['module_group'] = module_group
            all_modules.add(module)
            all_module_groups.add(module_group)

        if options.get('testMethod', True):
            methods = extract_test_methods(sections)
            tc_data['methods'] = methods
            all_methods.update(methods)

        if options.get('implType', True):
            impl_types = extract_implementation_type(sections)
            impl_group = get_impl_group(impl_types)
            tc_data['impl_types'] = impl_types
            tc_data['impl_group'] = impl_group
            all_impl_types.update(impl_types)
            all_impl_groups.add(impl_group)

        results.append(tc_data)

    return results, all_automation, all_modules, all_module_groups, all_methods, all_impl_types, all_impl_groups


def create_excel_step1(results, all_automation, all_modules, all_methods, all_impl_types, output_path, options):
    """Step 1: Create Excel with raw categorization (full module names)"""
    try:
        import openpyxl
        from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
    except ImportError:
        print("openpyxl not installed. Cannot create Excel file.")
        return False

    print(f"Step 1: Creating raw categorization...")

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Step1_Raw"

    headers = ['TC_ID']

    if options.get('automation', True):
        sorted_automation = sorted(all_automation)
        for auto in sorted_automation:
            headers.append(f"Auto_{auto.replace(' ', '_').replace('-', '_')}")

    if options.get('module', True):
        sorted_modules = sorted(all_modules)
        for mod in sorted_modules:
            # Full module name (no truncation)
            safe_mod = mod.replace(' ', '_').replace('/', '_').replace('(', '').replace(')', '')
            headers.append(f"Mod_{safe_mod}")

    if options.get('testMethod', True):
        sorted_methods = sorted(all_methods)
        for method in sorted_methods:
            headers.append(f"TM_{method}")

    if options.get('implType', True):
        sorted_impl = sorted(all_impl_types)
        for impl in sorted_impl:
            headers.append(f"Impl_{impl}")

    # Styling
    header_fill = PatternFill(start_color="4472C4", end_color="4472C4", fill_type="solid")
    header_font = Font(bold=True, color="FFFFFF")
    thin_border = Border(
        left=Side(style='thin'), right=Side(style='thin'),
        top=Side(style='thin'), bottom=Side(style='thin')
    )
    yes_fill = PatternFill(start_color="C6EFCE", end_color="C6EFCE", fill_type="solid")

    # Write headers
    for col, header in enumerate(headers, 1):
        cell = ws.cell(row=1, column=col, value=header)
        cell.fill = header_fill
        cell.font = header_font
        cell.alignment = Alignment(horizontal='center')
        cell.border = thin_border

    sorted_automation = sorted(all_automation) if options.get('automation', True) else []
    sorted_modules = sorted(all_modules) if options.get('module', True) else []
    sorted_methods = sorted(all_methods) if options.get('testMethod', True) else []
    sorted_impl = sorted(all_impl_types) if options.get('implType', True) else []

    for row_idx, tc_data in enumerate(results, 2):
        col = 1

        ws.cell(row=row_idx, column=col, value=tc_data['TC_ID']).border = thin_border
        col += 1

        if options.get('automation', True):
            for auto in sorted_automation:
                cell = ws.cell(row=row_idx, column=col)
                if tc_data.get('automation') == auto:
                    cell.value = 'Y'
                    cell.fill = yes_fill
                else:
                    cell.value = ''
                cell.alignment = Alignment(horizontal='center')
                cell.border = thin_border
                col += 1

        if options.get('module', True):
            for mod in sorted_modules:
                cell = ws.cell(row=row_idx, column=col)
                if tc_data.get('module') == mod:
                    cell.value = 'Y'
                    cell.fill = yes_fill
                else:
                    cell.value = ''
                cell.alignment = Alignment(horizontal='center')
                cell.border = thin_border
                col += 1

        if options.get('testMethod', True):
            methods = tc_data.get('methods', set())
            for method in sorted_methods:
                cell = ws.cell(row=row_idx, column=col)
                if method in methods:
                    cell.value = 'Y'
                    cell.fill = yes_fill
                else:
                    cell.value = ''
                cell.alignment = Alignment(horizontal='center')
                cell.border = thin_border
                col += 1

        if options.get('implType', True):
            impl_types = tc_data.get('impl_types', set())
            for impl in sorted_impl:
                cell = ws.cell(row=row_idx, column=col)
                if impl in impl_types:
                    cell.value = 'Y'
                    cell.fill = yes_fill
                else:
                    cell.value = ''
                cell.alignment = Alignment(horizontal='center')
                cell.border = thin_border
                col += 1

    for col in range(1, len(headers) + 1):
        ws.column_dimensions[openpyxl.utils.get_column_letter(col)].width = 20

    ws.column_dimensions['A'].width = 12
    ws.freeze_panes = 'B2'
    ws.auto_filter.ref = ws.dimensions

    wb.save(output_path)
    print(f"Created: {output_path}")
    return True


def create_excel_step2(results, all_automation, all_module_groups, all_methods, all_impl_types, output_path, options):
    """Step 2: Create Excel with grouped modules"""
    try:
        import openpyxl
        from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
    except ImportError:
        print("openpyxl not installed. Cannot create Excel file.")
        return False

    print(f"Step 2: Creating module-grouped categorization...")

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Step2_ModuleGroups"

    headers = ['TC_ID']

    if options.get('automation', True):
        sorted_automation = sorted(all_automation)
        for auto in sorted_automation:
            headers.append(f"Auto_{auto.replace(' ', '_').replace('-', '_')}")

    if options.get('module', True):
        sorted_groups = sorted(all_module_groups)
        for grp in sorted_groups:
            safe_grp = grp.replace(' ', '_').replace('/', '_').replace('(', '').replace(')', '')
            headers.append(f"ModGrp_{safe_grp}")

    if options.get('testMethod', True):
        sorted_methods = sorted(all_methods)
        for method in sorted_methods:
            headers.append(f"TM_{method}")

    if options.get('implType', True):
        sorted_impl = sorted(all_impl_types)
        for impl in sorted_impl:
            headers.append(f"Impl_{impl}")

    # Styling
    header_fill = PatternFill(start_color="70AD47", end_color="70AD47", fill_type="solid")
    header_font = Font(bold=True, color="FFFFFF")
    thin_border = Border(
        left=Side(style='thin'), right=Side(style='thin'),
        top=Side(style='thin'), bottom=Side(style='thin')
    )
    yes_fill = PatternFill(start_color="C6EFCE", end_color="C6EFCE", fill_type="solid")

    for col, header in enumerate(headers, 1):
        cell = ws.cell(row=1, column=col, value=header)
        cell.fill = header_fill
        cell.font = header_font
        cell.alignment = Alignment(horizontal='center')
        cell.border = thin_border

    sorted_automation = sorted(all_automation) if options.get('automation', True) else []
    sorted_groups = sorted(all_module_groups) if options.get('module', True) else []
    sorted_methods = sorted(all_methods) if options.get('testMethod', True) else []
    sorted_impl = sorted(all_impl_types) if options.get('implType', True) else []

    for row_idx, tc_data in enumerate(results, 2):
        col = 1

        ws.cell(row=row_idx, column=col, value=tc_data['TC_ID']).border = thin_border
        col += 1

        if options.get('automation', True):
            for auto in sorted_automation:
                cell = ws.cell(row=row_idx, column=col)
                if tc_data.get('automation') == auto:
                    cell.value = 'Y'
                    cell.fill = yes_fill
                else:
                    cell.value = ''
                cell.alignment = Alignment(horizontal='center')
                cell.border = thin_border
                col += 1

        if options.get('module', True):
            for grp in sorted_groups:
                cell = ws.cell(row=row_idx, column=col)
                if tc_data.get('module_group') == grp:
                    cell.value = 'Y'
                    cell.fill = yes_fill
                else:
                    cell.value = ''
                cell.alignment = Alignment(horizontal='center')
                cell.border = thin_border
                col += 1

        if options.get('testMethod', True):
            methods = tc_data.get('methods', set())
            for method in sorted_methods:
                cell = ws.cell(row=row_idx, column=col)
                if method in methods:
                    cell.value = 'Y'
                    cell.fill = yes_fill
                else:
                    cell.value = ''
                cell.alignment = Alignment(horizontal='center')
                cell.border = thin_border
                col += 1

        if options.get('implType', True):
            impl_types = tc_data.get('impl_types', set())
            for impl in sorted_impl:
                cell = ws.cell(row=row_idx, column=col)
                if impl in impl_types:
                    cell.value = 'Y'
                    cell.fill = yes_fill
                else:
                    cell.value = ''
                cell.alignment = Alignment(horizontal='center')
                cell.border = thin_border
                col += 1

    for col in range(1, len(headers) + 1):
        ws.column_dimensions[openpyxl.utils.get_column_letter(col)].width = 25

    ws.column_dimensions['A'].width = 12
    ws.freeze_panes = 'B2'
    ws.auto_filter.ref = ws.dimensions

    wb.save(output_path)
    print(f"Created: {output_path}")
    return True


def create_excel_step3(results, all_automation, all_module_groups, all_methods, all_impl_groups, output_path, options):
    """Step 3: Create refined Excel with summary statistics and implementation groups"""
    try:
        import openpyxl
        from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
    except ImportError:
        print("openpyxl not installed. Cannot create Excel file.")
        return False

    print(f"Step 3: Creating refined categorization with summary...")

    wb = openpyxl.Workbook()

    # Main data sheet
    ws = wb.active
    ws.title = "Categorization"

    headers = ['TC_ID', 'Module_Group', 'Impl_Group']

    if options.get('automation', True):
        sorted_automation = sorted(all_automation)
        for auto in sorted_automation:
            headers.append(f"Auto_{auto.replace(' ', '_').replace('-', '_')}")

    if options.get('testMethod', True):
        sorted_methods = sorted(all_methods)
        for method in sorted_methods:
            headers.append(f"TM_{method}")

    if options.get('implType', True):
        sorted_impl_groups = sorted(all_impl_groups)
        for impl_grp in sorted_impl_groups:
            headers.append(f"ImplGrp_{impl_grp}")

    # Styling
    header_fill = PatternFill(start_color="ED7D31", end_color="ED7D31", fill_type="solid")
    header_font = Font(bold=True, color="FFFFFF")
    thin_border = Border(
        left=Side(style='thin'), right=Side(style='thin'),
        top=Side(style='thin'), bottom=Side(style='thin')
    )
    yes_fill = PatternFill(start_color="C6EFCE", end_color="C6EFCE", fill_type="solid")

    for col, header in enumerate(headers, 1):
        cell = ws.cell(row=1, column=col, value=header)
        cell.fill = header_fill
        cell.font = header_font
        cell.alignment = Alignment(horizontal='center')
        cell.border = thin_border

    sorted_automation = sorted(all_automation) if options.get('automation', True) else []
    sorted_methods = sorted(all_methods) if options.get('testMethod', True) else []
    sorted_impl_groups = sorted(all_impl_groups) if options.get('implType', True) else []

    for row_idx, tc_data in enumerate(results, 2):
        col = 1

        ws.cell(row=row_idx, column=col, value=tc_data['TC_ID']).border = thin_border
        col += 1

        # Module Group as text
        cell = ws.cell(row=row_idx, column=col, value=tc_data.get('module_group', 'Unknown'))
        cell.border = thin_border
        col += 1

        # Impl Group as text
        cell = ws.cell(row=row_idx, column=col, value=tc_data.get('impl_group', 'Generic'))
        cell.border = thin_border
        col += 1

        if options.get('automation', True):
            for auto in sorted_automation:
                cell = ws.cell(row=row_idx, column=col)
                if tc_data.get('automation') == auto:
                    cell.value = 'Y'
                    cell.fill = yes_fill
                else:
                    cell.value = ''
                cell.alignment = Alignment(horizontal='center')
                cell.border = thin_border
                col += 1

        if options.get('testMethod', True):
            methods = tc_data.get('methods', set())
            for method in sorted_methods:
                cell = ws.cell(row=row_idx, column=col)
                if method in methods:
                    cell.value = 'Y'
                    cell.fill = yes_fill
                else:
                    cell.value = ''
                cell.alignment = Alignment(horizontal='center')
                cell.border = thin_border
                col += 1

        if options.get('implType', True):
            tc_impl_group = tc_data.get('impl_group', 'Generic')
            for impl_grp in sorted_impl_groups:
                cell = ws.cell(row=row_idx, column=col)
                if tc_impl_group == impl_grp:
                    cell.value = 'Y'
                    cell.fill = yes_fill
                else:
                    cell.value = ''
                cell.alignment = Alignment(horizontal='center')
                cell.border = thin_border
                col += 1

    for col in range(1, len(headers) + 1):
        ws.column_dimensions[openpyxl.utils.get_column_letter(col)].width = 20

    ws.column_dimensions['A'].width = 12
    ws.column_dimensions['B'].width = 35
    ws.column_dimensions['C'].width = 15
    ws.freeze_panes = 'D2'
    ws.auto_filter.ref = ws.dimensions

    # Summary sheet
    ws_summary = wb.create_sheet(title="Summary")

    summary_header_fill = PatternFill(start_color="5B9BD5", end_color="5B9BD5", fill_type="solid")

    # Module Group counts
    ws_summary.cell(row=1, column=1, value="Module Group").fill = summary_header_fill
    ws_summary.cell(row=1, column=1).font = header_font
    ws_summary.cell(row=1, column=2, value="Count").fill = summary_header_fill
    ws_summary.cell(row=1, column=2).font = header_font

    group_counts = {}
    for tc in results:
        grp = tc.get('module_group', 'Unknown')
        group_counts[grp] = group_counts.get(grp, 0) + 1

    for row, (grp, count) in enumerate(sorted(group_counts.items()), 2):
        ws_summary.cell(row=row, column=1, value=grp)
        ws_summary.cell(row=row, column=2, value=count)

    # Impl Group counts (start from column 4)
    start_row = len(group_counts) + 4
    ws_summary.cell(row=start_row, column=1, value="Impl Group").fill = summary_header_fill
    ws_summary.cell(row=start_row, column=1).font = header_font
    ws_summary.cell(row=start_row, column=2, value="Count").fill = summary_header_fill
    ws_summary.cell(row=start_row, column=2).font = header_font

    impl_counts = {}
    for tc in results:
        impl_grp = tc.get('impl_group', 'Generic')
        impl_counts[impl_grp] = impl_counts.get(impl_grp, 0) + 1

    for row, (impl_grp, count) in enumerate(sorted(impl_counts.items()), start_row + 1):
        ws_summary.cell(row=row, column=1, value=impl_grp)
        ws_summary.cell(row=row, column=2, value=count)

    ws_summary.column_dimensions['A'].width = 40
    ws_summary.column_dimensions['B'].width = 10

    wb.save(output_path)
    print(f"Created: {output_path}")
    return True


def create_final_excel(results, all_automation, all_module_groups, all_methods, all_impl_groups, output_path, options):
    """Final: Create the final combined Excel with simplified columns"""
    try:
        import openpyxl
        from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
    except ImportError:
        print("openpyxl not installed. Cannot create Excel file.")
        return False

    print(f"Final: Creating final categorization...")

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Categorization"

    # Simplified headers: TC_ID, Module_Group, Impl_Group, Automation (text), TM_* (Boolean)
    headers = ['TC_ID', 'Module_Group', 'Impl_Group']

    if options.get('automation', True):
        headers.append('Automation')  # Single text column instead of multiple Boolean

    if options.get('testMethod', True):
        sorted_methods = sorted(all_methods)
        for method in sorted_methods:
            headers.append(f"TM_{method}")

    # No ModGrp_ columns
    # No ImplGrp_ columns

    # Styling - Purple for final
    header_fill = PatternFill(start_color="7030A0", end_color="7030A0", fill_type="solid")
    header_font = Font(bold=True, color="FFFFFF")
    thin_border = Border(
        left=Side(style='thin'), right=Side(style='thin'),
        top=Side(style='thin'), bottom=Side(style='thin')
    )
    yes_fill = PatternFill(start_color="C6EFCE", end_color="C6EFCE", fill_type="solid")

    for col, header in enumerate(headers, 1):
        cell = ws.cell(row=1, column=col, value=header)
        cell.fill = header_fill
        cell.font = header_font
        cell.alignment = Alignment(horizontal='center')
        cell.border = thin_border

    sorted_methods = sorted(all_methods) if options.get('testMethod', True) else []

    for row_idx, tc_data in enumerate(results, 2):
        col = 1

        ws.cell(row=row_idx, column=col, value=tc_data['TC_ID']).border = thin_border
        col += 1

        # Module Group as text
        cell = ws.cell(row=row_idx, column=col, value=tc_data.get('module_group', 'Unknown'))
        cell.border = thin_border
        col += 1

        # Impl Group as text
        cell = ws.cell(row=row_idx, column=col, value=tc_data.get('impl_group', 'Generic'))
        cell.border = thin_border
        col += 1

        # Automation as text (single column)
        if options.get('automation', True):
            cell = ws.cell(row=row_idx, column=col, value=tc_data.get('automation', 'Unknown'))
            cell.border = thin_border
            col += 1

        # Test Methods (Boolean columns)
        if options.get('testMethod', True):
            methods = tc_data.get('methods', set())
            for method in sorted_methods:
                cell = ws.cell(row=row_idx, column=col)
                if method in methods:
                    cell.value = 'Y'
                    cell.fill = yes_fill
                else:
                    cell.value = ''
                cell.alignment = Alignment(horizontal='center')
                cell.border = thin_border
                col += 1

    for col in range(1, len(headers) + 1):
        ws.column_dimensions[openpyxl.utils.get_column_letter(col)].width = 18

    ws.column_dimensions['A'].width = 12
    ws.column_dimensions['B'].width = 35
    ws.column_dimensions['C'].width = 15
    ws.column_dimensions['D'].width = 18
    ws.freeze_panes = 'E2'
    ws.auto_filter.ref = ws.dimensions

    wb.save(output_path)
    print(f"COMPLETE:{output_path}", flush=True)
    return True


def main():
    if len(sys.argv) < 3:
        print("Usage: python categorizer.py <testcase_dir> <options_json>")
        sys.exit(1)

    testcase_dir = sys.argv[1]
    options_json = sys.argv[2]

    try:
        options = json.loads(options_json)
    except json.JSONDecodeError:
        print("Invalid options JSON")
        sys.exit(1)

    print(f"Categorizing testcases in: {testcase_dir}")
    print(f"Options: {options}")

    if not os.path.isdir(testcase_dir):
        print(f"Directory not found: {testcase_dir}")
        sys.exit(1)

    # Categorize
    result = categorize_testcases(testcase_dir, options)
    if not result:
        sys.exit(1)

    results, all_automation, all_modules, all_module_groups, all_methods, all_impl_types, all_impl_groups = result

    # Create .vvu.category folder
    category_dir = os.path.join(testcase_dir, '.vvu.category')
    os.makedirs(category_dir, exist_ok=True)

    # Step 1: Raw categorization
    output_path_1 = os.path.join(category_dir, 'ctg_1.xlsx')
    success1 = create_excel_step1(results, all_automation, all_modules, all_methods, all_impl_types, output_path_1, options)

    # Step 2: Module grouping
    output_path_2 = os.path.join(category_dir, 'ctg_2.xlsx')
    success2 = create_excel_step2(results, all_automation, all_module_groups, all_methods, all_impl_types, output_path_2, options)

    # Step 3: Refined with summary
    output_path_3 = os.path.join(category_dir, 'ctg_3.xlsx')
    success3 = create_excel_step3(results, all_automation, all_module_groups, all_methods, all_impl_groups, output_path_3, options)

    # Final
    output_path_final = os.path.join(category_dir, 'ctg_final.xlsx')
    success_final = create_final_excel(results, all_automation, all_module_groups, all_methods, all_impl_groups, output_path_final, options)

    if success_final:
        print(f"\nCategorization complete!")
        print(f"Total testcases: {len(results)}")
        print(f"Unique modules: {len(all_modules)}")
        print(f"Module groups: {len(all_module_groups)}")
        print(f"Files created:")
        print(f"  - {output_path_1}")
        print(f"  - {output_path_2}")
        print(f"  - {output_path_3}")
        print(f"  - {output_path_final} (Final)")
    else:
        sys.exit(1)


if __name__ == "__main__":
    main()
