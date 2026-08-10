import { Component, EventEmitter, Output, ViewChild, ElementRef, AfterViewInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DeleteAuthService } from '../../services/delete-auth.service';

@Component({
  selector: 'app-delete-code-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './delete-code-dialog.component.html',
  styleUrl: './delete-code-dialog.component.scss'
})
export class DeleteCodeDialogComponent implements AfterViewInit {
  @Output() verified = new EventEmitter<void>();
  @Output() cancelled = new EventEmitter<void>();

  @ViewChild('codeInput') codeInputRef!: ElementRef<HTMLInputElement>;

  code: string = '';
  error: string = '';
  isVerifying: boolean = false;

  constructor(private deleteAuth: DeleteAuthService) {}

  ngAfterViewInit() {
    setTimeout(() => this.codeInputRef?.nativeElement?.focus(), 0);
  }

  async submit() {
    if (!this.code.trim() || this.isVerifying) return;
    this.isVerifying = true;
    this.error = '';
    const ok = await this.deleteAuth.verifyCode(this.code);
    this.isVerifying = false;
    if (ok) {
      this.code = '';
      this.verified.emit();
    } else {
      this.error = 'Incorrect code.';
      this.code = '';
      setTimeout(() => this.codeInputRef?.nativeElement?.focus(), 0);
    }
  }

  cancel() {
    this.code = '';
    this.error = '';
    this.cancelled.emit();
  }
}