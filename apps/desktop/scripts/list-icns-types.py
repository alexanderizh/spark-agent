import icnsutil.IcnsType as mod
src = open(mod.__file__, 'rb').read().decode('utf-8', errors='replace')
# Print all lines that look like type code definitions
for line in src.split('\n'):
    line = line.strip()
    if "'" in line and 'PNG' not in line and 'JP2' not in line and 'RGB' not in line and 'ARGB' not in line:
        if 'type' in line.lower() or 'ext' in line.lower() or 'desc' in line.lower():
            print(line[:120])
