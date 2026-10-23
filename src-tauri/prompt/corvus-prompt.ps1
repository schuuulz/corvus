# Corvus: shows the current branch in the prompt, in its graph colour.
# Dot-sourced once when the terminal starts; wraps the existing prompt.

$global:CorvusBasePrompt = $function:prompt

function global:prompt {
    # The git call below must not leak into the user's last exit code.
    $exitCode = $global:LASTEXITCODE
    $base = & $global:CorvusBasePrompt
    $branch = git branch --show-current 2>$null
    $global:LASTEXITCODE = $exitCode
    if (-not $branch) { return $base }

    # Trunk green, unless the app has coloured this branch.
    $rgb = '16;185;129'
    if ($env:CORVUS_PROMPT_FILE) {
        $saved = Get-Content -LiteralPath $env:CORVUS_PROMPT_FILE -Raw -ErrorAction SilentlyContinue
        if ($saved) {
            $name, $color = $saved.Trim() -split ' ', 2
            if ($name -eq $branch) { $rgb = $color }
        }
    }

    $esc = [char]27
    $label = "$esc[38;2;${rgb}m($branch)$esc[0m"
    # "PS C:\repo> " becomes "PS C:\repo (main)> ".
    if ($base -match '^(.*?)(>+\s*)$') { return "$($Matches[1]) $label$($Matches[2])" }
    return "$base$label "
}
