 class Node { val = 0; }
      //@export
      function stressAlloc(n = 0) {
        let i = 0;
        let last = 0;
        while (i < n) {
          const node = new Node();
          node.val = i;
          last = node.val;
          i = i + 1;
        }
        return last;
      }
