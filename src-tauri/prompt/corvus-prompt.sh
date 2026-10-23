# Corvus: shows the current branch in the prompt, in its graph colour.
# Sourced before every prompt through PROMPT_COMMAND (bash).

corvus_status=$?

# The prompt to decorate, saved once. Git Bash's own branch segment is
# dropped so the branch isn't shown twice.
if [ -z "${CORVUS_BASE_PS1+set}" ]; then
  CORVUS_BASE_PS1=${PS1//\`__git_ps1\`/}
fi

corvus_branch=$(git branch --show-current 2>/dev/null)
if [ -z "$corvus_branch" ]; then
  PS1=$CORVUS_BASE_PS1
else
  # Trunk green, unless the app has coloured this branch.
  corvus_rgb="16;185;129"
  if read -r corvus_name corvus_color < "$CORVUS_PROMPT_FILE" 2>/dev/null && [ "$corvus_name" = "$corvus_branch" ]; then
    corvus_rgb=$corvus_color
  fi
  corvus_label="\[\e[38;2;${corvus_rgb}m\](${corvus_branch})\[\e[0m\]"

  # "user@host:~/repo$ " becomes "user@host:~/repo (main) $ ".
  case $CORVUS_BASE_PS1 in
    *'\$ ') corvus_tail='\$ ' ;;
    *'$ ') corvus_tail='$ ' ;;
    *) corvus_tail='' ;;
  esac
  corvus_head=${CORVUS_BASE_PS1%"$corvus_tail"}
  case $corvus_head in
    '' | *'\n' | *' ') corvus_gap='' ;;
    *) corvus_gap=' ' ;;
  esac
  PS1="$corvus_head$corvus_gap$corvus_label $corvus_tail"
fi

# Leave $? as the user's last command left it.
return "$corvus_status"
